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
  private readonly sessionTimeoutMs = 8000;
  private lastSessionRefreshAt = 0;
  private readonly minSessionRefreshGapMs = 4000;

  constructor(private router: Router) {
    void this.loadSession();

    supabase.auth.onAuthStateChange(async (event, session) => {
      this.setSession(session);

      if (!session?.user) {
        await this.handleSignedOutState();
        return;
      }

      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        await this.ensureProfileRecord(session.user);
      }
    });

  }

  get currentSession(): Session | null {
    return this.sessionSubject.value;
  }

  async refreshSessionIfNeeded(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.lastSessionRefreshAt < this.minSessionRefreshGapMs) {
      return;
    }

    this.lastSessionRefreshAt = now;
    await this.loadSession();
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
        const { data, error } = await this.withTimeout(supabase.auth.getSession(), this.sessionTimeoutMs);
        if (error) {
          return;
        }

        const session = data.session;
        this.setSession(session);

        if (!session?.user) {
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
        this.setSession(null);
        return verifyError;
      }
    }

    return null;
  }

  async login(email: string, password: string): Promise<string | null> {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return error.message;

      this.setSession(data.session);

      if (data.user) {
        const profileError = await this.ensureProfileRecord(data.user);
        if (profileError) return profileError;
      }

      return null;
    } catch {
      return 'Login failed due to network error. Please try again.';
    }
  }

  async loginWithOAuth(provider: 'google'): Promise<string | null> {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          // Supabase dashboard must include this URL in Authentication > URL Configuration > Redirect URLs.
          redirectTo: this.getOAuthRedirectUrl()
        }
      });

      if (!error) return null;

      if (this.isUnsupportedProviderError(error.message)) {
        return `${provider[0].toUpperCase() + provider.slice(1)} login is not enabled in Supabase Auth. Please enable it in Authentication → Providers, then try again.`;
      }

      return error.message;
    } catch {
      return 'Unable to start social login. Please try again.';
    }
  }

  async deleteCurrentAccount(): Promise<string | null> {
    try {
      const { error: cleanupError } = await supabase.rpc('delete_my_account_data');
      if (cleanupError) return cleanupError.message;

      const { error: edgeError } = await supabase.functions.invoke('delete-auth-user');
      if (edgeError) {
        return 'Your app data was deleted, but auth account deletion requires the delete-auth-user edge function deployment.';
      }

      await this.logout();
      return null;
    } catch {
      return 'Failed to delete account. Please try again.';
    }
  }

  async logout(): Promise<void> {
    await supabase.auth.signOut();
    this.setSession(null);
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

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => window.setTimeout(() => reject(new Error('timeout')), timeoutMs))
    ]);
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


  private getOAuthRedirectUrl(): string {
    const configured = environment.emailRedirectUrl?.trim();
    if (configured) return configured;

    if (typeof window !== 'undefined') {
      return `${window.location.origin}/auth`;
    }

    return '/auth';
  }

  private isExistingEmailError(message: string): boolean {
    const text = message.toLowerCase();
    return text.includes('already registered') || text.includes('already been registered') || text.includes('user already registered');
  }

  private isNetworkFetchError(message: string): boolean {
    const text = message.toLowerCase();
    return text.includes('failed to fetch') || text.includes('network request failed') || text.includes('fetch failed');
  }

  private isUnsupportedProviderError(message: string): boolean {
    const text = message.toLowerCase();
    return text.includes('unsupported provider') || text.includes('provider is not enabled');
  }

  private async ensureProfileRecord(user: User): Promise<string | null> {
    const sessionUserId = this.currentSession?.user.id ?? user.id;
    if (!sessionUserId || sessionUserId !== user.id) {
      return null;
    }

    const displayName =
      user.user_metadata?.['display_name'] ||
      user.user_metadata?.['full_name'] ||
      user.user_metadata?.['name'] ||
      user.email ||
      null;
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

  private setSession(session: Session | null): void {
    const current = this.sessionSubject.value;
    const sameUser = current?.user.id === session?.user.id;
    const sameAccessToken = current?.access_token === session?.access_token;
    if (sameUser && sameAccessToken) {
      return;
    }

    this.sessionSubject.next(session);
  }
}
