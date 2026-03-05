import { Component, OnDestroy } from '@angular/core';
import { NavigationStart, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
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

  constructor(
    public authService: AuthService,
    public messageNotificationService: MessageNotificationService,
    private router: Router
  ) {
    this.subscription = this.router.events.subscribe(async (event) => {
      if (event instanceof NavigationStart) {
        await this.authService.loadSession();

        if (event.url.startsWith('/requests') || event.url.startsWith('/messages') || event.url.startsWith('/chat')) {
          this.messageNotificationService.clearUnread();
        }
      }
    });
  }

  get isLoggedIn(): boolean {
    return !!this.authService.currentSession;
  }

  closeNav() {
    this.isNavOpen = false;
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }
}
