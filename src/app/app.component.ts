import { Component, OnDestroy } from '@angular/core';
import { NavigationEnd, NavigationStart, Router, RouterOutlet } from '@angular/router';
import { OverflowNavComponent } from './shared/overflow-nav.component';
import { Subscription } from 'rxjs';
import { AuthService } from './services/auth.service';
import { MessageNotificationService } from './services/message-notification.service';
import { RequestNotificationService } from './services/request-notification.service';
import { NotificationService } from './services/notification.service';
import { AdminService } from './services/admin.service';
import { ActivityService } from './services/activity.service';
import { dataFetchErrorMessage, runSupabaseQuery, supabase } from './services/supabase-client';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, OverflowNavComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnDestroy {
  private readonly subscriptions = new Subscription();
  currentUrl = '/';
  authErrorMessage = '';
  readonly defaultAvatarUrl = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"%3E%3Crect width="80" height="80" fill="%23e9eef5"/%3E%3Ccircle cx="40" cy="30" r="14" fill="%2391a4b8"/%3E%3Cpath d="M16 68c2-13 12-21 24-21s22 8 24 21" fill="%2391a4b8"/%3E%3C/svg%3E';
  profileAvatarUrl = this.defaultAvatarUrl;
  private foregroundCheckInFlight = false;
  private hiddenAt = 0;
  private recoveryTimerId: number | null = null;

  constructor(
    public authService: AuthService,
    public messageNotificationService: MessageNotificationService,
    public requestNotificationService: RequestNotificationService,
    public notificationService: NotificationService,
    public adminService: AdminService,
    activityService: ActivityService,
    private router: Router
  ) {
    this.currentUrl = this.router.url;

    this.subscriptions.add(this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        if (event.url.startsWith('/messages') || event.url.startsWith('/chat')) {
          this.messageNotificationService.clearUnread();
        }

        if (event.url.startsWith('/requests')) {
          this.requestNotificationService.clearUnreadRequests();
        }
      }

      if (event instanceof NavigationEnd) {
        this.currentUrl = event.urlAfterRedirects;
        this.clearStaleOverlays();
      }
    }));

    this.subscriptions.add(this.authService.authError$.subscribe((message) => {
      this.authErrorMessage = message;
    }));

    this.subscriptions.add(this.authService.session$.subscribe(() => {
      void this.loadProfileAvatar();
    }));

    window.addEventListener('unhandledrejection', this.onUnhandledRejection);
    window.addEventListener('focus', this.onWindowFocus);
    window.addEventListener('online', this.onWindowOnline);
    window.addEventListener('pageshow', this.onPageShow);
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    void this.authService.ensureInitialized();
    void this.loadProfileAvatar();
  }

  get isLoggedIn(): boolean {
    return !!this.authService.currentSession;
  }

  isSectionActive(prefix: string): boolean {
    return this.currentUrl === prefix || this.currentUrl.startsWith(`${prefix}/`);
  }

  async logout() {
    await this.authService.logout();
  }

  private onUnhandledRejection = (event: PromiseRejectionEvent) => {
    console.error('Unhandled promise rejection', event.reason);
  };

  private onWindowFocus = () => {
    this.log('window focus -> foreground validation');
    void this.runForegroundValidation();
  };

  private onWindowOnline = () => {
    this.log('window online -> forced foreground validation');
    void this.runForegroundValidation(true);
  };

  private onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) {
      this.log('pageshow persisted -> forced foreground validation');
      void this.runForegroundValidation(true);
    }
  };

  private onVisibilityChange = () => {
    if (document.hidden) {
      this.hiddenAt = Date.now();
      return;
    }

    const hiddenMs = this.hiddenAt ? Date.now() - this.hiddenAt : 0;
    this.log('visibilitychange -> visible', { hiddenMs });
    void this.runForegroundValidation(hiddenMs > 10_000);
  };

  private async runForegroundValidation(force = false) {
    if (this.foregroundCheckInFlight) {
      this.log('foreground validation skipped (already in flight)');
      this.clearStaleOverlays();
      return;
    }

    this.foregroundCheckInFlight = true;
    this.recoveryTimerId = window.setTimeout(() => {
      this.foregroundCheckInFlight = false;
    }, 10_000);

    try {
      await this.authService.onAppForeground(force);
    } finally {
      if (this.recoveryTimerId) {
        window.clearTimeout(this.recoveryTimerId);
        this.recoveryTimerId = null;
      }
      this.foregroundCheckInFlight = false;
      this.clearStaleOverlays();
    }
  }

  private log(message: string, meta?: unknown) {
    if (meta !== undefined) {
      console.debug('[app]', message, meta);
      return;
    }
    console.debug('[app]', message);
  }

  private clearStaleOverlays() {
    const hasTripModal = !!document.querySelector('.trip-modal.show, .modal.show');
    if (hasTripModal) return;

    document.querySelectorAll('.modal-backdrop').forEach((node) => node.remove());
    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('padding-right');
  }



  onAvatarError(): void {
    this.profileAvatarUrl = this.defaultAvatarUrl;
  }

  private async loadProfileAvatar(): Promise<void> {
    const user = this.authService.currentSession?.user;
    if (!user) {
      this.profileAvatarUrl = this.defaultAvatarUrl;
      return;
    }

    const metadataAvatar = (user.user_metadata?.['avatar_url'] || user.user_metadata?.['picture'] || '').toString().trim();
    this.profileAvatarUrl = metadataAvatar || this.defaultAvatarUrl;

    try {
      const { data } = await runSupabaseQuery(
        'app.loadProfileAvatar',
        supabase
          .from('profiles')
          .select('avatar_url')
          .eq('id', user.id)
          .maybeSingle(),
        8000
      );

      const dbAvatar = (data?.avatar_url || '').toString().trim();
      if (dbAvatar) {
        this.profileAvatarUrl = dbAvatar;
      } else if (!metadataAvatar) {
        this.profileAvatarUrl = this.defaultAvatarUrl;
      }
    } catch (error) {
      this.log('loadProfileAvatar failed', { message: dataFetchErrorMessage('Loading avatar', error) });
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    window.removeEventListener('unhandledrejection', this.onUnhandledRejection);
    window.removeEventListener('focus', this.onWindowFocus);
    window.removeEventListener('online', this.onWindowOnline);
    window.removeEventListener('pageshow', this.onPageShow);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }
}
