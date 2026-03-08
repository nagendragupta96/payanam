import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase-client';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class RequestNotificationService {
  private readonly unreadRequestCountSubject = new BehaviorSubject<number>(0);
  readonly unreadRequestCount$ = this.unreadRequestCountSubject.asObservable();

  private requestChannel: RealtimeChannel | null = null;
  private currentUserId: string | null = null;

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
    const userId = this.authService.currentSession?.user.id ?? null;
    if (!userId) {
      this.currentUserId = null;
      this.clearUnreadRequests();
      this.unsubscribe();
      return;
    }

    if (this.currentUserId === userId && this.requestChannel) {
      return;
    }

    this.currentUserId = userId;
    await this.refreshCount(userId);
    this.subscribe(userId);
  }

  private subscribe(userId: string): void {
    this.unsubscribe();

    this.requestChannel = supabase
      .channel(`request-notify:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'requests', filter: `owner_id=eq.${userId}` }, () => {
        void this.refreshCount(userId);
      })
      .subscribe();
  }

  private async refreshCount(userId: string): Promise<void> {
    const { count } = await supabase
      .from('requests')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', userId)
      .eq('status', 'PENDING');

    this.unreadRequestCountSubject.next(count ?? 0);
  }

  private unsubscribe(): void {
    this.requestChannel?.unsubscribe();
    this.requestChannel = null;
  }
}
