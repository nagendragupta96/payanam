import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { RealtimeChannel } from '@supabase/supabase-js';
import { runSupabaseQuery, supabase } from './supabase-client';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class MessageNotificationService {
  private readonly unreadCountSubject = new BehaviorSubject<number>(0);
  readonly unreadCount$ = this.unreadCountSubject.asObservable();

  private messageChannel: RealtimeChannel | null = null;
  private threadChannel: RealtimeChannel | null = null;
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

  clearUnread() {
    this.unreadCountSubject.next(0);
  }

  private async resetForSession() {
    if (this.resetInFlight) {
      await this.resetInFlight;
      return;
    }

    this.resetInFlight = (async () => {
      const userId = this.authService.currentSession?.user.id ?? null;
      this.log('resetForSession start', { userId });
      if (!userId) {
        this.currentUserId = null;
        this.clearUnread();
        this.unsubscribe('signed-out');
        return;
      }

      if (this.currentUserId === userId && this.messageChannel && this.threadChannel) {
        return;
      }

      this.currentUserId = userId;
      this.clearUnread();
      try {
        await this.subscribeForUser(userId);
      } catch (error) {
        this.log('subscribeForUser failed', { message: error instanceof Error ? error.message : String(error) });
      }
      this.log('resetForSession complete', { userId });
    })();

    try {
      await this.resetInFlight;
    } finally {
      this.resetInFlight = null;
    }
  }

  private async subscribeForUser(userId: string) {
    this.unsubscribe('resubscribe');
    this.log('subscribeForUser', { userId });

    await this.subscribeToMessages(userId);

    this.threadChannel = supabase
      .channel(`thread-notify:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_threads' }, async (payload: any) => {
        if (!payload?.new) return;
        if (payload.new.owner_id !== userId && payload.new.requester_id !== userId) return;
        this.log('thread subscription triggered; refreshing message subscription', { userId });
        await this.subscribeToMessages(userId);
      })
      .subscribe((status) => this.log('thread subscription status', { userId, status }));
  }

  private async subscribeToMessages(userId: string) {
    this.unsubscribeMessageChannel('refresh-message-subscription');

    const { data, error } = await runSupabaseQuery(
      'message-notification.loadThreads',
      supabase
        .from('chat_threads')
        .select('id')
        .or(`owner_id.eq.${userId},requester_id.eq.${userId}`),
      10000
    );

    if (error || !data?.length) {
      if (error) this.log('message subscription thread lookup failed', { message: error.message });
      return;
    }

    const threadIds = data.map((row: any) => row.id).filter(Boolean);
    if (!threadIds.length) return;

    const filter = `thread_id=in.(${threadIds.join(',')})`;

    this.messageChannel = supabase
      .channel(`message-notify:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter }, (payload: any) => {
        if (!payload?.new) return;
        if (payload.new.sender_id === userId) return;
        this.unreadCountSubject.next(this.unreadCountSubject.value + 1);
      })
      .subscribe((status) => this.log('message subscription status', { userId, status }));

    this.log('message subscription created', { userId, threadCount: threadIds.length });
  }

  private unsubscribe(reason: string) {
    this.log('unsubscribe channels', {
      reason,
      hadMessageChannel: !!this.messageChannel,
      hadThreadChannel: !!this.threadChannel
    });
    this.unsubscribeMessageChannel(reason);
    if (this.threadChannel) {
      void this.threadChannel
        .unsubscribe()
        .then((status) => this.log('thread unsubscribe complete', { reason, status }));
    }
    this.threadChannel = null;
  }

  private unsubscribeMessageChannel(reason: string): void {
    if (!this.messageChannel) return;
    void this.messageChannel
      .unsubscribe()
      .then((status) => this.log('message unsubscribe complete', { reason, status }));
    this.messageChannel = null;
  }

  private log(message: string, meta?: unknown): void {
    if (meta !== undefined) {
      console.debug('[notify]', message, meta);
      return;
    }
    console.debug('[notify]', message);
  }
}
