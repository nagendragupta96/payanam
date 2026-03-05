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
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) return error.message;

    // Do not force profile insert at signup time because many Supabase setups
    // require email confirmation before an authenticated session exists.
    // In that state, RLS checks using auth.uid() will fail for insert.
    // Profile creation is handled after login/session establishment.
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

  private async ensureProfileRecord(user: User): Promise<string | null> {
    const sessionUserId = this.currentSession?.user.id;
    if (!sessionUserId || sessionUserId !== user.id) {
      // Avoid writing profiles without an authenticated JWT for this user.
      // This prevents false RLS errors during signup confirmation flows.
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
