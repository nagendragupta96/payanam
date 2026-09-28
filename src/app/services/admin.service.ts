import { Injectable, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { AuthService } from './auth.service';
import { runSupabaseQuery, supabase } from './supabase-client';

export type AdminSection = 'overview' | 'users' | 'posts' | 'activity' | 'user-activity';
export interface AdminUser {
  id: string; email: string; display_name: string; created_at: string;
  last_sign_in_at: string | null; is_admin: boolean; is_premium: boolean; posts: number;
}
export interface AdminPost {
  id: string; owner_id: string; owner_email: string; origin_airport_code: string;
  destination_airport_code: string; start_date: string; end_date: string; created_at: string; requests: number;
}
export interface ActivityEvent {
  id: number; created_at: string; actor_id: string | null; actor_is_admin: boolean;
  source: string; action: string; entity_type: string | null; entity_id: string | null;
  subject_user_id: string | null; details: Record<string, unknown>;
  actor_email?: string | null; actor_display_name?: string | null;
  subject_email?: string | null; subject_display_name?: string | null;
}
export interface AdminPage<T> { rows: T[]; total: number; }

@Injectable({ providedIn: 'root' })
export class AdminService implements OnDestroy {
  isAdmin = false;
  private generation = 0;
  private readonly subscriptions = new Subscription();
  constructor(private auth: AuthService) {
    this.subscriptions.add(auth.session$.subscribe(() => { this.isAdmin = false; void this.refreshAccess().catch(() => undefined); }));
    this.subscriptions.add(auth.appForeground$.subscribe(() => { void this.refreshAccess().catch(() => undefined); }));
  }

  async refreshAccess(): Promise<boolean> {
    const generation = ++this.generation;
    const actor = this.auth.currentSession?.user.id;
    if (!this.auth.currentSession?.user) { this.isAdmin = false; return false; }
    try {
      const allowed = await this.rpc<boolean>('is_app_admin');
      if (generation === this.generation) this.isAdmin = allowed === true;
      return allowed === true && actor === this.auth.currentSession?.user.id;
    } catch (error) {
      if (generation === this.generation) this.isAdmin = false;
      throw error;
    }
  }

  async rpc<T>(name: string, params?: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const { data, error } = await runSupabaseQuery(`admin.${name}`, supabase.rpc(name, params).abortSignal(controller.signal));
      if (error) {
        if (error.code === '42501') this.isAdmin = false;
        throw new Error(error.message);
      }
      return data as T;
    } finally { clearTimeout(timer); }
  }

  ngOnDestroy(): void { this.generation++; this.subscriptions.unsubscribe(); }
}
