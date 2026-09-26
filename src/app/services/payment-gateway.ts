import { inject, Injectable, InjectionToken } from '@angular/core';
import { runSupabaseQuery, supabase } from './supabase-client';

export interface SubscriptionCheckout {
  id: string;
  plan_code: string;
  provider: string;
  status: 'PENDING' | 'COMPLETED' | 'CANCELLED';
  expires_at: string;
  completed_at: string | null;
}

export interface PaymentGateway {
  create(): Promise<SubscriptionCheckout>;
  complete(checkout: SubscriptionCheckout): Promise<SubscriptionCheckout>;
  cancel(id: string): Promise<SubscriptionCheckout>;
}

export async function billingRpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await runSupabaseQuery('billing.' + name, supabase.rpc(name, args));
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') {
      throw new Error('Subscriptions are temporarily unavailable. Please try again later.');
    }
    throw new Error(error.message);
  }
  if (!data) throw new Error('No response received. Please try again.');
  return data as T;
}

@Injectable({ providedIn: 'root' })
export class MockPaymentGateway implements PaymentGateway {
  create(): Promise<SubscriptionCheckout> {
    return billingRpc('create_subscription_checkout');
  }

  complete(checkout: SubscriptionCheckout): Promise<SubscriptionCheckout> {
    if (checkout.provider !== 'mock') {
      return Promise.reject(new Error('This checkout requires a different payment provider.'));
    }
    return billingRpc('complete_mock_subscription_checkout', { p_checkout_id: checkout.id });
  }

  cancel(id: string): Promise<SubscriptionCheckout> {
    return billingRpc('cancel_subscription_checkout', { p_checkout_id: id });
  }
}

// Replace this adapter with hosted checkout; real fulfillment stays in a verified server webhook.
export const PAYMENT_GATEWAY = new InjectionToken<PaymentGateway>('PAYMENT_GATEWAY', {
  providedIn: 'root',
  factory: () => inject(MockPaymentGateway)
});
