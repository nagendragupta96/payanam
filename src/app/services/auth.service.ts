import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { Session, User } from '@supabase/supabase-js';
import { supabase, supabaseConfigIssue } from './supabase-client';
import { environment } from '../../environments/environment';

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

  }

  get currentSession(): Session | null {
    return this.sessionSubject.value;
  }

  getUserLabel(profile: any, fallbackEmail?: string): string {
    return profile?.display_name || fallbackEmail || 'User';
  }

  async loadSession(): Promise<void> {
    if (this.sessionCheckInFlight) {
      return this.sessionCheckInFlight;
    }

    this.sessionCheckInFlight = (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          return;
        }

        const session = data.session;
        this.sessionSubject.next(session);

        if (session?.user) {
          await this.ensureProfileRecord(session.user);
        } else {
          await this.handleSignedOutState();
        }
      } catch {
        // Do not force-logout users on transient network errors.
        return;
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

    if (supabaseConfigIssue) {
      return supabaseConfigIssue;
    }

    let data: { user: User | null; session: Session | null };
    let error: { message: string; status?: number } | null;

    try {
      const response = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: environment.emailRedirectUrl,
          data: {
            display_name: name
          }
        }
      });

      data = response.data;
      error = response.error;
    } catch {
      return 'Unable to reach Supabase. Please verify your supabaseUrl/anon key and network access, then try again.';
    }

    if (error) {
      if (this.isNetworkFetchError(error.message)) {
        return 'Unable to reach Supabase. Please verify your supabaseUrl/anon key and network access, then try again.';
      }

      if (this.isExistingEmailError(error.message)) {
        return 'An account already exists with this email. Please login instead.';
      }

      const status = (error as any)?.status as number | undefined;
      const msg = (error.message || '').toLowerCase();
      if ((status && status >= 500) || msg.includes('database error saving new user')) {
        return 'Signup failed while creating your profile. Please try again.';
      }

      return error.message;
    }

    if (!data.user) {
      return 'Signup failed while creating your profile. Please try again.';
    }

    // NOTE: client-side code cannot atomically roll back auth.users creation if a later
    // profile operation fails. We therefore rely on DB trigger provisioning and verify it here.
    // For email-confirmation signup, Supabase often returns no session until the user confirms
    // via email; in that case signup is still successful and should not be treated as a failure.
    if (data.session?.user) {
      const verifyError = await this.verifySignupProvisioning(data.user.id);
      if (verifyError) {
        await supabase.auth.signOut();
        this.sessionSubject.next(null);
        return verifyError;
      }
    }

    return null;
  }

  async login(email: string, password: string): Promise<string | null> {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return error.message;

      this.sessionSubject.next(data.session);

      if (data.user) {
        const profileError = await this.ensureProfileRecord(data.user);
        if (profileError) return profileError;
      }

      return null;
    } catch {
      return 'Login failed due to network error. Please try again.';
    }
  }

  async logout(): Promise<void> {
    await supabase.auth.signOut();
    this.sessionSubject.next(null);
    await this.router.navigate(['/auth']);
  }

  private async verifySignupProvisioning(userId: string): Promise<string | null> {
    for (let attempt = 0; attempt < 8; attempt++) {
      await this.loadSession();
      const sessionUserId = this.currentSession?.user.id;
      if (sessionUserId !== userId) {
        await this.wait(250);
        continue;
      }

      const profile = await supabase
        .from('profiles')
        .select('id')
        .eq('id', userId)
        .maybeSingle();

      if (profile.data?.id) {
        return null;
      }

      await this.wait(250);
    }

    return 'Signup failed while creating your profile. Please try again.';
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
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

  private isNetworkFetchError(message: string): boolean {
    const text = message.toLowerCase();
    return text.includes('failed to fetch') || text.includes('network request failed') || text.includes('fetch failed');
  }

  private async ensureProfileRecord(user: User): Promise<string | null> {
    const sessionUserId = this.currentSession?.user.id ?? user.id;
    if (!sessionUserId || sessionUserId !== user.id) {
      return null;
    }

    const displayName = user.user_metadata?.['display_name'] || user.email || null;
    const { error } = await supabase.from('profiles').upsert(
      {
        id: user.id,
        display_name: displayName,
        avatar_url: user.user_metadata?.['avatar_url'] ?? null
      },
      { onConflict: 'id' }
    );

    return error?.message ?? null;
  }
}
