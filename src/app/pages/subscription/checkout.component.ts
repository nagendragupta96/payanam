import { CommonModule } from '@angular/common';
import { Component, OnDestroy } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { NotificationService } from '../../services/notification.service';
import { SubscriptionCheckout } from '../../services/payment-gateway';
import { SubscriptionService } from '../../services/subscription.service';

@Component({
  selector: 'app-subscription-checkout',
  standalone: true,
  imports: [CommonModule, RouterLink],
  styleUrl: './subscription.css',
  template: `
    <section class="billing-page checkout-page" aria-labelledby="checkout-title">
      <a routerLink="/subscription" class="link-secondary">Back to subscription</a>
      <header class="billing-header mt-4"><div><p class="eyebrow">PAYANAM PREMIUM</p><h1 id="checkout-title">Checkout</h1></div><span class="badge text-bg-warning">Demo</span></header>
      <div *ngIf="loading" class="py-4" role="status"><span class="spinner-border spinner-border-sm me-2"></span>Loading checkout...</div>
      <div *ngIf="error" class="alert alert-danger" role="alert">{{ error }}
        <button *ngIf="!checkout" class="btn btn-sm btn-outline-danger ms-2" (click)="load()" [disabled]="loading">Retry</button>
      </div>
      <ng-container *ngIf="checkout && !loading">
        <div *ngIf="checkout.status === 'COMPLETED'" class="checkout-result" role="status">
          <span class="badge text-bg-success mb-3">Complete</span><h2>Premium activated</h2>
          <p>Your checkout is complete. No money was charged.</p>
          <div class="d-flex gap-3 flex-wrap mt-4"><a routerLink="/notifications" class="btn btn-success">View notifications</a><a routerLink="/subscription" class="btn btn-outline-secondary">Manage subscription</a></div>
        </div>
        <div *ngIf="checkout.status === 'CANCELLED'" class="checkout-result" role="status">
          <h2>Checkout cancelled</h2><p>Your subscription was not changed.</p><a routerLink="/subscription" class="btn btn-outline-primary">Return to plans</a>
        </div>
        <div *ngIf="checkout.status === 'PENDING' && expired" class="checkout-result" role="status">
          <h2>Checkout expired</h2><p>Your subscription was not changed.</p><a routerLink="/subscription" class="btn btn-primary">Start a new checkout</a>
        </div>
        <ng-container *ngIf="checkout.status === 'PENDING' && !expired">
          <dl class="checkout-summary"><div><dt>Plan</dt><dd>Premium</dd></div><div><dt>Payment method</dt><dd>Demo gateway</dd></div><div class="total"><dt>Total charged</dt><dd>$0.00</dd></div></dl>
          <p class="billing-note">This is a simulated payment. No card details are collected and no money will be charged.</p>
          <div class="checkout-actions">
            <button class="btn btn-primary" [disabled]="busy || checkout.provider !== 'mock'" (click)="complete()">
              <span *ngIf="busy" class="spinner-border spinner-border-sm me-2"></span>{{ busy ? 'Processing...' : 'Complete demo payment' }}
            </button>
            <button class="btn btn-outline-secondary" [disabled]="busy" (click)="cancel()">Cancel checkout</button>
          </div>
        </ng-container>
      </ng-container>
    </section>
  `
})
export class CheckoutComponent implements OnDestroy {
  checkout: SubscriptionCheckout | null = null;
  loading = false;
  busy = false;
  error = '';
  private readonly subscriptions = new Subscription();
  private checkoutId = '';
  private requestVersion = 0;
  private destroyed = false;

  constructor(private billing: SubscriptionService, route: ActivatedRoute, auth: AuthService, private notifications: NotificationService) {
    this.subscriptions.add(route.paramMap.subscribe(params => {
      this.checkoutId = params.get('id') ?? '';
      this.checkout = null;
      void this.load();
    }));
    this.subscriptions.add(auth.appForeground$.subscribe(() => { if (!this.busy && !this.loading) void this.load(); }));
  }

  get expired(): boolean { return !!this.checkout && Date.parse(this.checkout.expires_at) <= Date.now(); }

  async load(): Promise<void> {
    const version = ++this.requestVersion;
    this.loading = true;
    this.error = '';
    try {
      const checkout = await this.billing.getCheckout(this.checkoutId);
      if (!this.destroyed && version === this.requestVersion) this.checkout = checkout;
    } catch (error) {
      if (version === this.requestVersion) this.error = error instanceof Error ? error.message : 'Unable to load checkout.';
    } finally { if (version === this.requestVersion) this.loading = false; }
  }

  async complete(): Promise<void> {
    if (this.busy || !this.checkout) return;
    this.busy = true;
    this.error = '';
    const id = this.checkout.id;
    try {
      const result = await this.billing.completeCheckout(this.checkout);
      if (!this.destroyed && this.checkoutId === id) this.checkout = result;
      void this.notifications.refreshUnreadCount().catch(error => console.warn('[billing] Notification count refresh failed', error));
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Unable to complete checkout. Please try again.';
    } finally { this.busy = false; }
  }

  async cancel(): Promise<void> {
    if (this.busy || !this.checkout) return;
    this.busy = true;
    this.error = '';
    try { this.checkout = await this.billing.cancelCheckout(this.checkout.id); }
    catch (error) { this.error = error instanceof Error ? error.message : 'Unable to cancel checkout.'; }
    finally { this.busy = false; }
  }

  ngOnDestroy(): void { this.destroyed = true; this.subscriptions.unsubscribe(); }
}
