import { Injectable, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, Subject } from 'rxjs';
import { Session, User } from '@supabase/supabase-js';
import { supabase, supabaseConfigIssue } from './supabase-client';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AuthService implements OnDestroy {
  private readonly sessionSubject = new BehaviorSubject<Session | null>(null);
  readonly session$ = this.sessionSubject.asObservable();
  private readonly authErrorSubject = new BehaviorSubject<string>('');
  readonly authError$ = this.authErrorSubject.asObservable();
  private readonly appForegroundSubject = new Subject<number>();
  readonly appForeground$ = this.appForegroundSubject.asObservable();
  private sessionCheckInFlight: Promise<void> | null = null;
  private readonly sessionTimeoutMs = 8000;
  private readonly foregroundValidationTimeoutMs = 6000;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private lastForegroundValidationAt = 0;
  private readonly minForegroundValidationGapMs = 15000;
  private authStateSubscription: { unsubscribe: () => void } | null = null;
  private authListenerInitialized = false;
  private explicitLogoutInProgress = false;
  private restoreOnNullInFlight: Promise<boolean> | null = null;
  private foregroundValidationInFlight: Promise<void> | null = null;
  private forceResetInProgress = false;
  private authRecoveryInFlight: Promise<void> | null = null;
  private lastForegroundSignalAt = 0;
  private authStateQueue: Promise<void> = Promise.resolve();

  constructor(private router: Router) {
    this.debug('AuthService initialized');
    this.initPromise = this.loadSession().finally(() => {
      this.initialized = true;
      this.debug('Initial session bootstrap complete', { hasSession: !!this.currentSession?.user });
    });

    this.initAuthStateListener();

  }


  /**
   * Permanent session-stability fix:
   * - Register Supabase auth state listener exactly once for this service instance.
   * - Never clear an in-memory session on transient null auth events without explicit confirmation.
   */
  private initAuthStateListener(): void {
    if (this.authListenerInitialized && this.authStateSubscription) {
      this.debug('initAuthStateListener skipped (already initialized)');
      return;
    }

    this.authListenerInitialized = true;
    this.authStateSubscription = supabase.auth.onAuthStateChange((event, session) => {
      this.debug('onAuthStateChange event queued', {
        event,
        hasSession: !!session?.user,
        explicitLogoutInProgress: this.explicitLogoutInProgress
      });
      this.queueAuthStateHandling(event, session);
    }).data.subscription;
  }

  private queueAuthStateHandling(event: string, session: Session | null): void {
    this.authStateQueue = this.authStateQueue
      .then(() => this.processAuthStateChange(event, session))
      .catch((error) => {
        this.debug('processAuthStateChange failed', {
          event,
          message: error instanceof Error ? error.message : String(error)
        });
      });
  }

  private async processAuthStateChange(event: string, session: Session | null): Promise<void> {
    this.debug('processAuthStateChange start', { event, hasSession: !!session?.user });

    if (!session?.user) {
      const hadSession = !!this.currentSession?.user;

      if (this.explicitLogoutInProgress) {
        this.setSession(null);
        this.clearAuthError();
        await this.handleSignedOutState();
        this.explicitLogoutInProgress = false;
        return;
      }

      const restored = await this.tryRecoverSession(`auth-state:${event}`);
      if (restored) {
        return;
      }

      if (hadSession) {
        const confirmedInvalid = await this.confirmSessionInvalid(`auth-state:${event}`);
        if (!confirmedInvalid) {
          this.setAuthError('Connection interrupted. Reconnecting your session...');
          return;
        }
      }

      this.setSession(null);
      if (hadSession) {
        this.setAuthError('Your session has expired. Please login again.');
      } else {
        this.clearAuthError();
      }
      await this.handleSignedOutState();
      return;
    }

    this.setSession(session);
    this.clearAuthError();
    this.explicitLogoutInProgress = false;
    this.notifyAppForeground(`auth-event:${event}`);

    if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
      await this.ensureProfileRecord(session.user);
    }

    if (event === 'TOKEN_REFRESHED') {
      this.debug('Token refreshed successfully');
    }
  }

  ngOnDestroy(): void {
    this.authStateSubscription?.unsubscribe();
  }

  get currentSession(): Session | null {
    return this.sessionSubject.value;
  }

  async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await (this.initPromise ?? this.loadSession());
  }

  async onAppForeground(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.lastForegroundValidationAt < this.minForegroundValidationGapMs) {
      this.debug('Foreground validation skipped (throttled)');
      this.signalAppVisible('foreground-throttled');
      return;
    }

    if (this.foregroundValidationInFlight) {
      this.debug('Foreground validation skipped (already in flight)');
      this.signalAppVisible('foreground-in-flight');
      return;
    }

    this.lastForegroundValidationAt = now;
    const hadSession = !!this.currentSession?.user;
    this.foregroundValidationInFlight = (async () => {
      try {
        this.debug('Foreground validation start', { force });
        const { data, error } = await this.withTimeout(supabase.auth.getSession(), this.foregroundValidationTimeoutMs);
        if (error) {
          this.debug('Foreground validation ended with Supabase error', { message: error.message });
          return;
        }

        const session = data.session;
        this.debug('Foreground validation result', { hasSession: !!session?.user });
        if (!session?.user && hadSession) {
          const restored = await this.tryRecoverSession('foreground');
          if (restored) {
            this.debug('Foreground validation recovered session after transient null');
            return;
          }

          const confirmedInvalid = await this.confirmSessionInvalid('foreground');
          if (!confirmedInvalid) {
            this.setAuthError('Connection interrupted. Reconnecting your session...');
            return;
          }

          this.setSession(null);
          this.setAuthError('Your session has expired. Please login again.');
          await this.handleSignedOutState();
          return;
        }

        this.setSession(session);
        if (session?.user) {
          this.clearAuthError();
          this.notifyAppForeground('foreground-validation');
        }
        if (!session?.user) {
          if (hadSession) {
            this.setAuthError('Your session has expired. Please login again.');
          }
          await this.handleSignedOutState();
        }
      } catch {
        this.debug('Foreground validation timeout/network on first attempt; retrying once');

        try {
          await this.wait(500);
          const retry = await this.withTimeout(supabase.auth.getSession(), this.sessionTimeoutMs);
          const retrySession = retry.data.session;
          this.debug('Foreground validation retry result', { hasSession: !!retrySession?.user });

          if (retrySession?.user) {
            this.setSession(retrySession);
            this.clearAuthError();
            return;
          }

          if (hadSession) {
            this.setAuthError('Connection interrupted. Reconnecting your session...');
          }
        } catch {
          this.debug('Foreground validation retry failed; leaving current state untouched');
        }
      }
    })();

    try {
      await this.foregroundValidationInFlight;
    } finally {
      this.foregroundValidationInFlight = null;
    }
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
        this.debug('loadSession start');
        const { data, error } = await this.withTimeout(supabase.auth.getSession(), this.sessionTimeoutMs);
        if (error) {
          this.debug('loadSession supabase error', { message: error.message });
          return;
        }

        const session = data.session;
        const hadSession = !!this.currentSession?.user;
        if (!session?.user && hadSession) {
          const restored = await this.tryRecoverSession('loadSession');
          if (restored) {
            return;
          }

          const confirmedInvalid = await this.confirmSessionInvalid('loadSession');
          if (!confirmedInvalid) {
            this.setAuthError('Connection interrupted. Reconnecting your session...');
            return;
          }

          this.setSession(null);
          this.setAuthError('Your session has expired. Please login again.');
          await this.handleSignedOutState();
          return;
        }

        this.setSession(session);
        if (session?.user) {
          this.clearAuthError();
        }
        this.debug('loadSession result', { hasSession: !!session?.user });

        if (!session?.user) {
          if (hadSession) {
            this.setAuthError('Your session has expired. Please login again.');
          }
          await this.handleSignedOutState();
        }
      } catch {
        // Do not force-logout users on transient network errors.
        this.debug('loadSession timeout/network error');
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
      if (error) {
        if (this.isAccountNotFoundError(error.message)) {
          return 'Account does not exist. Please sign up first.';
        }
        return error.message;
      }

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
    this.explicitLogoutInProgress = true;
    this.debug('logout start');
    try {
      await this.withTimeout(supabase.auth.signOut(), this.sessionTimeoutMs);
    } catch {
      // Even if signOut request fails, clear local app auth state to avoid a stuck UI.
      this.debug('logout signOut timeout/network; proceeding with local cleanup');
    } finally {
      this.setSession(null);
      this.clearAuthError();
      this.sessionCheckInFlight = null;
      this.lastForegroundValidationAt = 0;
      await this.router.navigate(['/auth']);
      this.debug('logout complete');
    }
  }

  /**
   * Temporary fail-safe: hard reset all local auth/session state if app detects half-authenticated lockups.
   * Keep until root cause of stale session behavior is fully resolved.
   */
  async forceResetSession(reason = 'unknown'): Promise<void> {
    if (this.forceResetInProgress) {
      this.debug('forceResetSession skipped (already in progress)', { reason });
      return;
    }

    this.forceResetInProgress = true;
    this.debug('forceResetSession invoked', { reason });

    try {
      try {
        await this.withTimeout(supabase.auth.signOut(), this.sessionTimeoutMs);
      } catch {
        this.debug('forceResetSession signOut failed; continuing with local cleanup');
      }

      try {
        supabase.removeAllChannels();
      } catch {
        this.debug('forceResetSession removeAllChannels failed');
      }

      this.clearStoredAuthArtifacts();
      this.explicitLogoutInProgress = false;
      this.sessionCheckInFlight = null;
      this.foregroundValidationInFlight = null;
      this.restoreOnNullInFlight = null;
      this.lastForegroundValidationAt = 0;
      this.setSession(null);
      this.setAuthError('Your session ended. Please log in again.');

      if (!this.router.url.startsWith('/auth')) {
        await this.router.navigate(['/auth']);
      }
    } finally {
      this.forceResetInProgress = false;
    }
  }


  async recoverSessionForDataQuery(operation: string, message: string): Promise<boolean> {
    this.debug('recoverSessionForDataQuery', { operation, message });
    if (!this.isAuthFailureMessage(message)) return false;

    const restored = await this.tryRecoverSession(`data:${operation}`);
    if (restored) {
      return true;
    }

    const confirmedInvalid = await this.confirmSessionInvalid(`data:${operation}`);
    if (!confirmedInvalid && !!this.currentSession?.user) {
      return true;
    }

    this.setSession(null);
    this.setAuthError('Your session has expired. Please login again.');
    await this.handleSignedOutState();
    return false;
  }

  reportAuthFailure(operation: string, message: string): void {
    this.debug('reportAuthFailure', { operation, message });
    if (!this.isAuthFailureMessage(message)) return;
    if (!this.currentSession?.user) return;

    if (this.authRecoveryInFlight) {
      this.debug('reportAuthFailure skipped (recovery already in flight)', { operation });
      return;
    }

    this.authRecoveryInFlight = (async () => {
      const restored = await this.tryRecoverSession(`query:${operation}`);
      if (restored) {
        this.clearAuthError();
        this.notifyAppForeground(`query-recovered:${operation}`);
        return;
      }

      // Keep the current in-memory session and let explicit SIGNED_OUT events drive hard logout.
      // This avoids destructive resets from transient, operation-level auth timing errors.
      this.setAuthError('Connection interrupted. Reconnecting your session...');
    })().finally(() => {
      this.authRecoveryInFlight = null;
    });
  }

  signalAppVisible(source: string): void {
    this.notifyAppForeground(source);
  }


  private async confirmSessionInvalid(source: string): Promise<boolean> {
    this.debug('confirmSessionInvalid start', { source });

    if (this.explicitLogoutInProgress) {
      return true;
    }

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const { data, error } = await this.withTimeout(supabase.auth.getSession(), this.sessionTimeoutMs);
        if (!error && data.session?.user) {
          this.debug('confirmSessionInvalid recovered via getSession', { source, attempt });
          this.setSession(data.session);
          this.clearAuthError();
          return false;
        }
      } catch {
        this.debug('confirmSessionInvalid getSession timeout', { source, attempt });
      }
      await this.wait(250 * attempt);
    }

    try {
      const { data, error } = await this.withTimeout(supabase.auth.refreshSession(), this.sessionTimeoutMs);
      if (!error && data.session?.user) {
        this.debug('confirmSessionInvalid recovered via refreshSession', { source });
        this.setSession(data.session);
        this.clearAuthError();
        return false;
      }
    } catch {
      this.debug('confirmSessionInvalid refreshSession timeout', { source });
    }

    this.debug('confirmSessionInvalid confirmed invalid', { source });
    return true;
  }

  private async tryRecoverSession(source: string): Promise<boolean> {
    this.debug('tryRecoverSession start', { source });

    const recoveredFromNullEvent = await this.restoreSessionAfterNullEvent();
    if (recoveredFromNullEvent) {
      this.debug('tryRecoverSession recovered via null-event restore', { source });
      this.clearAuthError();
      return true;
    }

    for (let attempt = 1; attempt <= 2; attempt++) {
      await this.wait(300 * attempt);
      try {
        const { data, error } = await this.withTimeout(supabase.auth.getSession(), this.sessionTimeoutMs);
        if (!error && data.session?.user) {
          this.setSession(data.session);
          this.clearAuthError();
          this.debug('tryRecoverSession recovered via delayed getSession', { source, attempt });
          return true;
        }
      } catch {
        this.debug('tryRecoverSession delayed getSession timed out', { source, attempt });
      }
    }

    this.debug('tryRecoverSession failed', { source });
    return false;
  }

  private async restoreSessionAfterNullEvent(): Promise<boolean> {
    if (this.restoreOnNullInFlight) {
      return this.restoreOnNullInFlight;
    }

    this.restoreOnNullInFlight = (async () => {
      try {
        const { data, error } = await this.withTimeout(supabase.auth.getSession(), this.sessionTimeoutMs);
        if (error || !data.session?.user) {
          return false;
        }

        this.setSession(data.session);
        return true;
      } catch {
        return false;
      }
    })();

    try {
      return await this.restoreOnNullInFlight;
    } finally {
      this.restoreOnNullInFlight = null;
    }
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
    if (onProtectedRoute && !this.router.url.startsWith('/auth')) {
      await this.router.navigate(['/auth']);
    }
  }

  private isProtectedRoute(path: string): boolean {
    const protectedPrefixes = ['/profile', '/create-itinerary', '/my-trips', '/requests', '/messages', '/chat', '/settings', '/admin'];
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


  private isAccountNotFoundError(message: string): boolean {
    const text = (message || '').toLowerCase();
    return text.includes('invalid login credentials') || text.includes('user not found') || text.includes('account does not exist');
  }

  private isNetworkFetchError(message: string): boolean {
    const text = message.toLowerCase();
    return text.includes('failed to fetch') || text.includes('network request failed') || text.includes('fetch failed');
  }

  private isAuthFailureMessage(message: string): boolean {
    const text = (message || '').toLowerCase();
    return (
      text.includes('jwt expired') ||
      text.includes('invalid jwt') ||
      text.includes('not authenticated') ||
      text.includes('auth session missing') ||
      text.includes('invalid refresh token') ||
      text.includes('refresh token not found') ||
      text.includes('session expired') ||
      text.includes('invalid token') ||
      text.includes('unauthorized')
    );
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
    this.debug('session updated', { hasSession: !!session?.user });
  }

  private setAuthError(message: string): void {
    if (this.authErrorSubject.value === message) return;
    this.authErrorSubject.next(message);
    this.debug('auth error set', { message });
  }

  private clearAuthError(): void {
    if (!this.authErrorSubject.value) return;
    this.authErrorSubject.next('');
    this.debug('auth error cleared');
  }

  private clearStoredAuthArtifacts(): void {
    if (typeof window === 'undefined') return;

    const clearMatching = (storage: Storage) => {
      const keys: string[] = [];
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (!key) continue;
        if (key.startsWith('sb-') && key.includes('-auth-token')) {
          keys.push(key);
        }
      }
      keys.forEach((key) => storage.removeItem(key));
    };

    clearMatching(window.localStorage);
    clearMatching(window.sessionStorage);
  }

  private notifyAppForeground(source: string): void {
    if (!this.currentSession?.user) return;
    const now = Date.now();
    if (now - this.lastForegroundSignalAt < 1000) return;
    this.lastForegroundSignalAt = now;
    this.debug('notifyAppForeground', { source });
    this.appForegroundSubject.next(now);
  }

  private debug(message: string, meta?: unknown): void {
    if (meta !== undefined) {
      console.debug('[auth]', message, meta);
      return;
    }
    console.debug('[auth]', message);
  }
}
