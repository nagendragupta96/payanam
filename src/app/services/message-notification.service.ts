import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase-client';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class MessageNotificationService {
  private readonly unreadCountSubject = new BehaviorSubject<number>(0);
  readonly unreadCount$ = this.unreadCountSubject.asObservable();

  private messageChannel: RealtimeChannel | null = null;
  private threadChannel: RealtimeChannel | null = null;
  private currentUserId: string | null = null;

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
    const userId = this.authService.currentSession?.user.id ?? null;
    if (!userId) {
      this.currentUserId = null;
      this.clearUnread();
      this.unsubscribe();
      return;
    }

    if (this.currentUserId === userId && this.messageChannel && this.threadChannel) {
      return;
    }

    this.currentUserId = userId;
    this.clearUnread();
    await this.subscribeForUser(userId);
  }

  private async subscribeForUser(userId: string) {
    this.unsubscribe();

    await this.subscribeToMessages(userId);

    this.threadChannel = supabase
      .channel(`thread-notify:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_threads' }, async (payload: any) => {
        if (!payload?.new) return;
        if (payload.new.owner_id !== userId && payload.new.requester_id !== userId) return;
        await this.subscribeToMessages(userId);
      })
      .subscribe();
  }

  private async subscribeToMessages(userId: string) {
    this.messageChannel?.unsubscribe();
    this.messageChannel = null;

    const { data, error } = await supabase
      .from('chat_threads')
      .select('id')
      .or(`owner_id.eq.${userId},requester_id.eq.${userId}`);

    if (error || !data?.length) {
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
      .subscribe();
  }

  private unsubscribe() {
    this.messageChannel?.unsubscribe();
    this.threadChannel?.unsubscribe();
    this.messageChannel = null;
    this.threadChannel = null;
  }
}
