import { CommonModule } from '@angular/common';
import { Component, OnDestroy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { AppNotification, NotificationService } from '../../services/notification.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-notifications',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="card shadow-sm">
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-center mb-3">
          <h2 class="h4 mb-0">Notifications</h2>
          <button class="btn btn-outline-primary btn-sm" type="button" [disabled]="loading" (click)="refresh()">
            <span *ngIf="loading" class="spinner-border spinner-border-sm me-2"></span>
            Refresh
          </button>
        </div>

        <div class="alert alert-danger" *ngIf="errorMessage">{{ errorMessage }}</div>
        <div class="alert alert-secondary py-2" *ngIf="loading">Loading notifications...</div>

        <div *ngIf="!loading && !notifications.length && !errorMessage" class="alert alert-secondary mb-0">
          No notifications yet.
        </div>

        <div class="list-group" *ngIf="notifications.length">
          <div
            class="list-group-item"
            *ngFor="let notification of notifications"
            [class.bg-light]="!notification.is_read"
          >
            <div class="d-flex justify-content-between gap-3 flex-wrap">
              <div>
                <div class="fw-semibold">{{ notification.title }}</div>
                <div class="small text-muted">{{ formatCreatedAt(notification.created_at) }}</div>
              </div>
              <span class="badge text-bg-primary align-self-start" *ngIf="!notification.is_read">New</span>
            </div>
            <p class="mb-2 mt-2">{{ notification.body }}</p>
            <a
              *ngIf="notification.itinerary_id"
              class="btn btn-sm btn-outline-primary"
              [routerLink]="['/itinerary', notification.itinerary_id]"
            >
              View Trip
            </a>
          </div>
        </div>
      </div>
    </div>
  `
})
export class NotificationsComponent implements OnDestroy {
  notifications: AppNotification[] = [];
  loading = false;
  errorMessage = '';
  private readonly subscriptions = new Subscription();

  constructor(
    private notificationService: NotificationService,
    private authService: AuthService
  ) {
    this.subscriptions.add(this.authService.appForeground$.subscribe(() => {
      void this.load();
    }));
    void this.load();
  }

  async refresh(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.errorMessage = '';

    try {
      const result = await this.notificationService.list();
      this.notifications = result.data;
      if (result.error) {
        this.errorMessage = result.error;
        return;
      }

      const markReadError = await this.notificationService.markAllRead();
      if (markReadError) {
        this.errorMessage = markReadError;
      } else {
        this.notifications = this.notifications.map((notification) => ({ ...notification, is_read: true }));
      }
    } catch {
      this.errorMessage = 'Notifications failed to load. Please try again.';
    } finally {
      this.loading = false;
    }
  }

  formatCreatedAt(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }
}
