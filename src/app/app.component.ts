import { Component, OnDestroy } from '@angular/core';
import { NavigationEnd, NavigationStart, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from './services/auth.service';
import { MessageNotificationService } from './services/message-notification.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnDestroy {
  isNavOpen = false;
  private readonly subscriptions = new Subscription();
  currentUrl = '/';
  authErrorMessage = '';
  private foregroundCheckInFlight = false;
  private hiddenAt = 0;
  private recoveryTimerId: number | null = null;

  constructor(
    public authService: AuthService,
    public messageNotificationService: MessageNotificationService,
    private router: Router
  ) {
    this.currentUrl = this.router.url;

    this.subscriptions.add(this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        if (event.url.startsWith('/requests') || event.url.startsWith('/messages') || event.url.startsWith('/chat')) {
          this.messageNotificationService.clearUnread();
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

    window.addEventListener('unhandledrejection', this.onUnhandledRejection);
    window.addEventListener('focus', this.onWindowFocus);
    window.addEventListener('online', this.onWindowOnline);
    window.addEventListener('pageshow', this.onPageShow);
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    void this.authService.ensureInitialized();
  }

  get isLoggedIn(): boolean {
    return !!this.authService.currentSession;
  }

  isSectionActive(prefix: string): boolean {
    return this.currentUrl === prefix || this.currentUrl.startsWith(`${prefix}/`);
  }

  closeNav() {
    this.isNavOpen = false;
  }

  async logout() {
    this.closeNav();
    await this.authService.logout();
  }

  private onUnhandledRejection = (event: PromiseRejectionEvent) => {
    console.error('Unhandled promise rejection', event.reason);
  };

  private onWindowFocus = () => {
    this.log('window focus -> lightweight foreground validation');
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
    // Always force validation when returning to a visible tab to avoid throttling stale sessions.
    void this.runForegroundValidation(true);
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

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    window.removeEventListener('unhandledrejection', this.onUnhandledRejection);
    window.removeEventListener('focus', this.onWindowFocus);
    window.removeEventListener('online', this.onWindowOnline);
    window.removeEventListener('pageshow', this.onPageShow);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }
}
