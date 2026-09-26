import { inject, Injectable } from '@angular/core';
import { billingRpc, PAYMENT_GATEWAY, SubscriptionCheckout } from './payment-gateway';
import { runSupabaseQuery, supabase } from './supabase-client';

export interface SubscriptionOverview {
  plan_code: string;
  status: string;
  is_premium: boolean;
  mock_enabled: boolean;
}

@Injectable({ providedIn: 'root' })
export class SubscriptionService {
  private readonly gateway = inject(PAYMENT_GATEWAY);

  getOverview(): Promise<SubscriptionOverview> {
    return billingRpc('get_my_subscription');
  }

  startCheckout(): Promise<SubscriptionCheckout> {
    return this.gateway.create();
  }

  completeCheckout(checkout: SubscriptionCheckout): Promise<SubscriptionCheckout> {
    return this.gateway.complete(checkout);
  }

  cancelCheckout(id: string): Promise<SubscriptionCheckout> {
    return this.gateway.cancel(id);
  }

  async getCheckout(id: string): Promise<SubscriptionCheckout> {
    const { data, error } = await runSupabaseQuery('billing.getCheckout', supabase
      .from('subscription_checkouts')
      .select('id, plan_code, provider, status, expires_at, completed_at')
      .eq('id', id).maybeSingle());
    if (error) throw new Error('Unable to load checkout. Please try again.');
    if (!data) throw new Error('Checkout not found or unavailable for this account.');
    return data as SubscriptionCheckout;
  }
}
