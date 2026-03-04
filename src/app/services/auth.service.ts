import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { Session } from '@supabase/supabase-js';
import { supabase } from './supabase-client';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly sessionSubject = new BehaviorSubject<Session | null>(null);
  readonly session$ = this.sessionSubject.asObservable();

  constructor(private router: Router) {
    this.loadSession();
    supabase.auth.onAuthStateChange((_event, session) => {
      this.sessionSubject.next(session);
    });
  }

  get currentSession(): Session | null {
    return this.sessionSubject.value;
  }

  async loadSession(): Promise<void> {
    const { data } = await supabase.auth.getSession();
    this.sessionSubject.next(data.session);
  }

  async signup(email: string, password: string): Promise<string | null> {
    const { error } = await supabase.auth.signUp({ email, password });
    return error?.message ?? null;
  }

  async login(email: string, password: string): Promise<string | null> {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error?.message ?? null;
  }

  async logout(): Promise<void> {
    await supabase.auth.signOut();
    await this.router.navigate(['/']);
  }
}
