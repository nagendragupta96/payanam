import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase-client';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly sessionSubject = new BehaviorSubject<Session | null>(null);
  readonly session$ = this.sessionSubject.asObservable();

  constructor(private router: Router) {
    this.loadSession();
    supabase.auth.onAuthStateChange(async (_event, session) => {
      this.sessionSubject.next(session);
      if (session?.user) await this.ensureProfileRecord(session.user);
    });
  }

  get currentSession(): Session | null {
    return this.sessionSubject.value;
  }

  async loadSession(): Promise<void> {
    const { data } = await supabase.auth.getSession();
    this.sessionSubject.next(data.session);
    if (data.session?.user) await this.ensureProfileRecord(data.session.user);
  }

  async signup(email: string, password: string): Promise<string | null> {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth` }
    });

    if (error) {
      if (this.isExistingEmailError(error.message)) {
        return 'An account already exists with this email. Please login instead.';
      }
      return error.message;
    }

    // Supabase can return no explicit error for existing confirmed users
    // when email confirmation is enabled. Detect by empty identities list.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return 'An account already exists with this email. Please login instead.';
    }

    return null;
  }

  async login(email: string, password: string): Promise<string | null> {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return error.message;
    if (data.user) return this.ensureProfileRecord(data.user);
    return null;
  }

  async logout(): Promise<void> {
    await supabase.auth.signOut();
    await this.router.navigate(['/']);
  }

  private isExistingEmailError(message: string): boolean {
    const text = message.toLowerCase();
    return text.includes('already registered') || text.includes('already been registered') || text.includes('user already registered');
  }

  private async ensureProfileRecord(user: User): Promise<string | null> {
    const sessionUserId = this.currentSession?.user.id;
    if (!sessionUserId || sessionUserId !== user.id) {
      return null;
    }

    const { error } = await supabase.from('profiles').upsert(
      {
        id: user.id,
        display_name: user.user_metadata?.['display_name'] ?? user.email ?? null,
        avatar_url: user.user_metadata?.['avatar_url'] ?? null
      },
      { onConflict: 'id' }
    );

    return error?.message ?? null;
  }
}
