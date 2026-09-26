import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { RealtimeChannel } from '@supabase/supabase-js';
import { AuthService } from './auth.service';
import { runSupabaseQuery, supabase } from './supabase-client';

export interface AppNotification {
  id: string;
  user_id: string;
  type: 'AUTO_MATCH' | string;
  title: string;
  body: string;
  itinerary_id?: string | null;
  is_read: boolean;
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly unreadCountSubject = new BehaviorSubject<number>(0);
  readonly unreadCount$ = this.unreadCountSubject.asObservable();
  private channel: RealtimeChannel | null = null;
  private currentUserId: string | null = null;
  private resetInFlight: Promise<void> | null = null;

  constructor(private authService: AuthService) {
    this.authService.session$.subscribe(() => {
      void this.resetForSession();
    });
  }

  get unreadCount(): number {
    return this.unreadCountSubject.value;
  }

  async createAutoMatchNotifications(itineraryId: string): Promise<{ count: number; error: string | null }> {
    if (!itineraryId) return { count: 0, error: null };

    try {
      const { data, error } = await runSupabaseQuery(
        'notifications.createAutoMatchNotifications',
        supabase.rpc('create_auto_match_notifications', { p_itinerary_id: itineraryId }),
        10000
      );

      if (error) {
        return { count: 0, error: error.message };
      }

      return { count: Number(data ?? 0), error: null };
    } catch (error) {
      return { count: 0, error: error instanceof Error ? error.message : 'Auto-match notification creation failed.' };
    }
  }

  async list(limit = 50): Promise<{ data: AppNotification[]; error: string | null }> {
    try {
      const { data, error } = await runSupabaseQuery(
        'notifications.list',
        supabase
          .from('notifications')
          .select('id, user_id, type, title, body, itinerary_id, is_read, created_at')
          .order('created_at', { ascending: false })
          .limit(limit),
        10000
      );

      return { data: (data as AppNotification[]) ?? [], error: error?.message ?? null };
    } catch (error) {
      return { data: [], error: error instanceof Error ? error.message : 'Notifications failed to load.' };
    }
  }

  async markAllRead(): Promise<string | null> {
    const userId = this.authService.currentSession?.user.id;
    if (!userId) return null;

    try {
      const { error } = await runSupabaseQuery(
        'notifications.markAllRead',
        supabase
          .from('notifications')
          .update({ is_read: true })
          .eq('user_id', userId)
          .eq('is_read', false),
        10000
      );

      if (!error) {
        this.unreadCountSubject.next(0);
      }

      return error?.message ?? null;
    } catch (error) {
      return error instanceof Error ? error.message : 'Unable to mark notifications as read.';
    }
  }

  async refreshUnreadCount(): Promise<void> {
    const userId = this.authService.currentSession?.user.id;
    if (!userId) {
      this.unreadCountSubject.next(0);
      return;
    }

    const { count } = await runSupabaseQuery(
      'notifications.refreshUnreadCount',
      supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('is_read', false),
      10000
    );

    this.unreadCountSubject.next(count ?? 0);
  }

  private async resetForSession(): Promise<void> {
    if (this.resetInFlight) {
      await this.resetInFlight;
      return;
    }

    this.resetInFlight = (async () => {
      const userId = this.authService.currentSession?.user.id ?? null;
      if (!userId) {
        this.currentUserId = null;
        this.unreadCountSubject.next(0);
        this.unsubscribe('signed-out');
        return;
      }

      if (this.currentUserId === userId && this.channel) {
        await this.refreshUnreadCount();
        return;
      }

      this.currentUserId = userId;
      await this.refreshUnreadCount().catch((error) => {
        this.log('refreshUnreadCount failed', { message: error instanceof Error ? error.message : String(error) });
      });
      this.subscribe(userId);
    })();

    try {
      await this.resetInFlight;
    } finally {
      this.resetInFlight = null;
    }
  }

  private subscribe(userId: string): void {
    this.unsubscribe('resubscribe');
    this.log('subscribe notifications', { userId });
    this.channel = supabase
      .channel(`notifications:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, () => {
        void this.refreshUnreadCount().catch((error) => {
          this.log('realtime refresh failed', { message: error instanceof Error ? error.message : String(error) });
        });
      })
      .subscribe((status) => this.log('notification subscription status', { userId, status }));
  }

  private unsubscribe(reason: string): void {
    if (!this.channel) return;
    this.log('unsubscribe notifications', { reason });
    void this.channel
      .unsubscribe()
      .then((status) => this.log('notification unsubscribe complete', { reason, status }));
    this.channel = null;
  }

  private log(message: string, meta?: unknown): void {
    if (meta !== undefined) {
      console.debug('[notifications]', message, meta);
      return;
    }
    console.debug('[notifications]', message);
  }
}
