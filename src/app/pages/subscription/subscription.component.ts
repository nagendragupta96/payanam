import { CommonModule } from '@angular/common';
import { Component, OnDestroy } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { SubscriptionOverview, SubscriptionService } from '../../services/subscription.service';

@Component({
  selector: 'app-subscription',
  standalone: true,
  imports: [CommonModule, RouterLink],
  styleUrl: './subscription.css',
  template: `
    <section class="billing-page" aria-labelledby="subscription-title">
      <header class="billing-header">
        <div><p class="eyebrow">YOUR ACCOUNT</p><h1 id="subscription-title">Subscription</h1></div>
        <a routerLink="/my-trips" class="link-secondary">My Trips</a>
      </header>
      <div *ngIf="loading" class="py-4" role="status"><span class="spinner-border spinner-border-sm me-2"></span>Loading subscription...</div>
      <div *ngIf="error" class="alert alert-danger" role="alert">
        {{ error }} <button *ngIf="!overview" class="btn btn-sm btn-outline-danger ms-2" (click)="load()" [disabled]="loading">Retry</button>
      </div>
      <ng-container *ngIf="overview && !loading">
        <div class="account-status">
          <div><span class="text-secondary">Current plan</span><strong>{{ overview.is_premium ? 'Premium' : 'Free' }}</strong></div>
          <span class="badge" [class.text-bg-success]="overview.is_premium" [class.text-bg-secondary]="!overview.is_premium">Active</span>
        </div>
        <p *ngIf="overview.is_premium" class="my-4">Auto Match Notifications are active for your saved itineraries.</p>
        <div class="plan-grid">
          <article class="plan">
            <h2>Free</h2><p class="price">$0</p><p class="text-secondary">Everyday travel planning</p>
            <ul><li>Post and manage trips</li><li>Search for travel companions</li><li>Requests and messages</li></ul>
            <a routerLink="/search" class="btn btn-outline-secondary mt-auto">Search trips</a>
          </article>
          <article class="plan premium">
            <div class="d-flex justify-content-between gap-2"><h2>Premium</h2><span class="badge text-bg-success align-self-start">Auto Match</span></div>
            <p class="price">$0 <span>demo checkout</span></p><p class="text-secondary">Matching trips, delivered to you</p>
            <ul><li>Everything in Free</li><li>Automatic route and date matching</li><li>In-app alerts for matching trips</li><li>Existing matches when you upgrade</li></ul>
            <a *ngIf="overview.is_premium" routerLink="/notifications" class="btn btn-success mt-auto">View notifications</a>
            <button *ngIf="!overview.is_premium" class="btn btn-primary mt-auto" [disabled]="starting || !overview.mock_enabled" (click)="subscribe()">
              <span *ngIf="starting" class="spinner-border spinner-border-sm me-2"></span>{{ starting ? 'Opening checkout...' : 'Continue to checkout' }}
            </button>
          </article>
        </div>
        <p class="billing-note" *ngIf="overview.mock_enabled">Demo checkout. No card details, charges, or automatic renewals.</p>
        <p class="billing-note" *ngIf="!overview.mock_enabled">Checkout is currently unavailable.</p>
      </ng-container>
    </section>
  `
})
export class SubscriptionComponent implements OnDestroy {
  overview: SubscriptionOverview | null = null;
  loading = false;
  starting = false;
  error = '';
  private readonly foreground: Subscription;
  private destroyed = false;

  constructor(private billing: SubscriptionService, private router: Router, auth: AuthService) {
    this.foreground = auth.appForeground$.subscribe(() => { if (!this.starting) void this.load(); });
    void this.load();
  }

  async load(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.error = '';
    try {
      const overview = await this.billing.getOverview();
      if (!this.destroyed) this.overview = overview;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Unable to load subscription.';
    } finally { this.loading = false; }
  }

  async subscribe(): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    this.error = '';
    try {
      const checkout = await this.billing.startCheckout();
      if (!this.destroyed) await this.router.navigate(['/subscription/checkout', checkout.id]);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Unable to start checkout.';
    } finally { this.starting = false; }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.foreground.unsubscribe();
  }
}
