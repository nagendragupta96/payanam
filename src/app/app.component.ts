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
        void this.authService.loadSession();
      }

      if (event instanceof NavigationEnd) {
        this.currentUrl = event.urlAfterRedirects;
      }
    });

    window.addEventListener('unhandledrejection', this.onUnhandledRejection);
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

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
    window.removeEventListener('unhandledrejection', this.onUnhandledRejection);
  }
}
