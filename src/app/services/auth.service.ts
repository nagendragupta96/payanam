import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase-client';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly sessionSubject = new BehaviorSubject<Session | null>(null);
  readonly session$ = this.sessionSubject.asObservable();
  private sessionCheckInFlight: Promise<void> | null = null;

  constructor(private router: Router) {
    void this.loadSession();

    supabase.auth.onAuthStateChange(async (_event, session) => {
      this.sessionSubject.next(session);

      if (session?.user) {
        await this.ensureProfileRecord(session.user);
      } else {
        await this.handleSignedOutState();
      }
    });

    window.setInterval(() => {
      void this.loadSession();
    }, 60000);
  }

  get currentSession(): Session | null {
    return this.sessionSubject.value;
  }

  getUserLabel(profile: any, fallbackEmail?: string): string {
    return profile?.full_name || profile?.display_name || fallbackEmail || 'User';
  }

  async loadSession(): Promise<void> {
    if (this.sessionCheckInFlight) {
      return this.sessionCheckInFlight;
    }

    this.sessionCheckInFlight = (async () => {
      const { data } = await supabase.auth.getSession();
      this.sessionSubject.next(data.session);

      if (data.session?.user) {
        await this.ensureProfileRecord(data.session.user);
      } else {
        const onProtectedRoute = this.isProtectedRoute(this.router.url);
        if (onProtectedRoute) {
          await this.router.navigate(['/auth']);
        }
      }
    })();

    try {
      await this.sessionCheckInFlight;
    } finally {
      this.sessionCheckInFlight = null;
    }
  }

  async signup(email: string, password: string, displayName: string): Promise<string | null> {
    const name = displayName.trim();
    if (!name) return 'Display Name is required.';

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth`,
        data: {
          display_name: name
        }
      }
    });

    if (error) {
      if (this.isExistingEmailError(error.message)) {
        return 'An account already exists with this email. Please login instead.';
      }
      return error.message;
    }

    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return 'An account already exists with this email. Please login instead.';
    }

    if (data.user) {
      const profileError = await this.ensureProfileRecord(data.user, name);
      if (profileError) return profileError;
    }

    return null;
  }

  async login(email: string, password: string): Promise<string | null> {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return error.message;

    this.sessionSubject.next(data.session);

    if (data.user) {
      const profileError = await this.ensureProfileRecord(data.user);
      if (profileError) return profileError;
    }

    return null;
  }

  async logout(): Promise<void> {
    await supabase.auth.signOut();
    this.sessionSubject.next(null);
    await this.router.navigate(['/auth']);
  }

  private async handleSignedOutState(): Promise<void> {
    const onProtectedRoute = this.isProtectedRoute(this.router.url);
    if (onProtectedRoute) {
      await this.router.navigate(['/auth']);
    }
  }

  private isProtectedRoute(path: string): boolean {
    const protectedPrefixes = ['/profile', '/create-itinerary', '/my-trips', '/requests', '/messages', '/chat', '/settings'];
    return protectedPrefixes.some((prefix) => path.startsWith(prefix));
  }

  private isExistingEmailError(message: string): boolean {
    const text = message.toLowerCase();
    return text.includes('already registered') || text.includes('already been registered') || text.includes('user already registered');
  }

  private async ensureProfileRecord(user: User, preferredName?: string): Promise<string | null> {
    const sessionUserId = this.currentSession?.user.id ?? user.id;
    if (!sessionUserId || sessionUserId !== user.id) {
      return null;
    }

    const fullName = preferredName || user.user_metadata?.['full_name'] || user.user_metadata?.['display_name'] || user.email || null;
    const { error } = await supabase.from('profiles').upsert(
      {
        id: user.id,
        display_name: user.user_metadata?.['display_name'] ?? fullName,
        avatar_url: user.user_metadata?.['avatar_url'] ?? null
      },
      { onConflict: 'id' }
    );

    return error?.message ?? null;
  }
}
