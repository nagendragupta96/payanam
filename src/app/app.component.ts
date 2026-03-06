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
  private readonly subscription: Subscription;
  currentUrl = '/';
  private recoveringState = false;
  private hiddenAt = 0;

  constructor(
    public authService: AuthService,
    public messageNotificationService: MessageNotificationService,
    private router: Router
  ) {
    this.currentUrl = this.router.url;

    this.subscription = this.router.events.subscribe(async (event) => {
      if (event instanceof NavigationStart) {
        if (event.url.startsWith('/requests') || event.url.startsWith('/messages') || event.url.startsWith('/chat')) {
          this.messageNotificationService.clearUnread();
        }
      }

      if (event instanceof NavigationEnd) {
        this.currentUrl = event.urlAfterRedirects;
        this.clearStaleOverlays();
      }
    });

    window.addEventListener('unhandledrejection', this.onUnhandledRejection);
    window.addEventListener('focus', this.onWindowFocus);
    window.addEventListener('online', this.onWindowOnline);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
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

  private onUnhandledRejection = (event: PromiseRejectionEvent) => {
    console.error('Unhandled promise rejection', event.reason);
  };

  private onWindowFocus = () => {
    void this.recoverAppState();
  };

  private onWindowOnline = () => {
    void this.recoverAppState(true);
  };

  private onVisibilityChange = () => {
    if (document.hidden) {
      this.hiddenAt = Date.now();
      return;
    }

    const hiddenMs = this.hiddenAt ? Date.now() - this.hiddenAt : 0;
    void this.recoverAppState(hiddenMs > 10_000);
  };

  private async recoverAppState(forceRefresh = false) {
    if (this.recoveringState) return;

    this.recoveringState = true;
    const startedAt = Date.now();

    try {
      await this.authService.refreshSessionIfNeeded(forceRefresh);
    } finally {
      this.clearStaleOverlays();
      const elapsed = Date.now() - startedAt;
      if (elapsed > 3000) {
        console.warn(`App state recovery took ${elapsed}ms`);
      }
      this.recoveringState = false;
    }
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
    this.subscription.unsubscribe();
    window.removeEventListener('unhandledrejection', this.onUnhandledRejection);
    window.removeEventListener('focus', this.onWindowFocus);
    window.removeEventListener('online', this.onWindowOnline);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }
}
