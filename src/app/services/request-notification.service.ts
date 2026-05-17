import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { RealtimeChannel } from '@supabase/supabase-js';
import { runSupabaseQuery, supabase } from './supabase-client';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class RequestNotificationService {
  private readonly unreadRequestCountSubject = new BehaviorSubject<number>(0);
  readonly unreadRequestCount$ = this.unreadRequestCountSubject.asObservable();

  private requestChannel: RealtimeChannel | null = null;
  private currentUserId: string | null = null;
  private resetInFlight: Promise<void> | null = null;

  constructor(private authService: AuthService) {
    this.authService.session$.subscribe(() => {
      void this.resetForSession();
    });
  }

  get unreadRequestCount(): number {
    return this.unreadRequestCountSubject.value;
  }

  clearUnreadRequests(): void {
    this.unreadRequestCountSubject.next(0);
  }

  private async resetForSession(): Promise<void> {
    if (this.resetInFlight) {
      await this.resetInFlight;
      return;
    }

    this.resetInFlight = (async () => {
      const userId = this.authService.currentSession?.user.id ?? null;
      this.log('resetForSession start', { userId });
      if (!userId) {
        this.currentUserId = null;
        this.clearUnreadRequests();
        this.unsubscribe('signed-out');
        return;
      }

      if (this.currentUserId === userId && this.requestChannel) {
        return;
      }

      this.currentUserId = userId;
      try {
        await this.refreshCount(userId);
      } catch (error) {
        this.log('refreshCount failed', { message: error instanceof Error ? error.message : String(error) });
      }
      this.subscribe(userId);
      this.log('resetForSession complete', { userId });
    })();

    try {
      await this.resetInFlight;
    } finally {
      this.resetInFlight = null;
    }
  }

  private subscribe(userId: string): void {
    this.unsubscribe('resubscribe');

    this.log('subscribe requests', { userId });
    this.requestChannel = supabase
      .channel(`request-notify:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'requests', filter: `owner_id=eq.${userId}` }, () => {
        void this.refreshCount(userId);
      })
      .subscribe((status) => this.log('request subscription status', { userId, status }));
  }

  private async refreshCount(userId: string): Promise<void> {
    const { count } = await runSupabaseQuery(
      'request-notification.refreshCount',
      supabase
        .from('requests')
        .select('id', { count: 'exact', head: true })
        .eq('owner_id', userId)
        .eq('status', 'PENDING'),
      10000
    );

    this.unreadRequestCountSubject.next(count ?? 0);
  }

  private unsubscribe(reason: string): void {
    if (this.requestChannel) {
      this.log('unsubscribe requests', { reason });
      void this.requestChannel
        .unsubscribe()
        .then((status) => this.log('request unsubscribe complete', { reason, status }));
    }
    this.requestChannel = null;
  }

  private log(message: string, meta?: unknown): void {
    if (meta !== undefined) {
      console.debug('[request-notify]', message, meta);
      return;
    }
    console.debug('[request-notify]', message);
  }
}
