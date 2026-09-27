import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { LucideAngularModule, RefreshCw, Search, Trash2, ChevronLeft, ChevronRight, X } from 'lucide-angular';
import { Subscription } from 'rxjs';
import { AdminPage, AdminPost, AdminSection, AdminService, AdminUser, ActivityEvent } from '../../services/admin.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-admin', standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, LucideAngularModule],
  templateUrl: './admin.component.html', styleUrl: './admin.component.css'
})
export class AdminComponent implements OnDestroy {
  readonly icons = { RefreshCw, Search, Trash2, ChevronLeft, ChevronRight, X };
  readonly tabs: { id: AdminSection; label: string }[] = [
    { id: 'overview', label: 'Overview' }, { id: 'users', label: 'Users' },
    { id: 'posts', label: 'Posts' }, { id: 'activity', label: 'Activity' }
  ];
  readonly groups = [
    { name: 'Accounts', metrics: [['users', 'Total users'], ['new_users_30d', 'Joined in 30 days'], ['premium_users', 'Premium users'], ['admins', 'Administrators']] },
    { name: 'Trips & Requests', metrics: [['posts', 'Total posts'], ['upcoming_posts', 'Current / upcoming posts'], ['new_posts_30d', 'Posted in 30 days'], ['requests', 'Total requests'], ['pending_requests', 'Pending requests'], ['accepted_requests', 'Accepted requests']] },
    { name: 'Communication', metrics: [['conversations', 'Conversations'], ['messages', 'Messages'], ['notifications', 'Notifications'], ['unread_notifications', 'Unread notifications']] },
    { name: 'Activity & Billing', metrics: [['active_users_7d', 'Active users in 7 days'], ['events_24h', 'Events in 24 hours'], ['client_errors_24h', 'Reported API errors in 24 hours'], ['completed_demo_checkouts', 'Completed demo checkouts']] }
  ];
  section: AdminSection = 'overview';
  stats: Record<string, number> = {};
  users: AdminUser[] = [];
  posts: AdminPost[] = [];
  events: ActivityEvent[] = [];
  total = 0;
  offset = 0;
  readonly pageSize = 25;
  search = ''; source = ''; actor = ''; from = ''; to = '';
  loading = false; deleting = false; error = ''; notice = ''; deleteError = '';
  reason = ''; confirmation = '';
  pending: { kind: 'user' | 'post'; id: string; label: string } | null = null;
  @ViewChild('deleteDialog') dialog?: ElementRef<HTMLDialogElement>;
  private requestVersion = 0;
  private subscriptions = new Subscription();
  private opener?: HTMLElement;

  constructor(public admin: AdminService, public auth: AuthService, route: ActivatedRoute) {
    this.subscriptions.add(route.paramMap.subscribe(params => {
      const section = params.get('section');
      this.section = this.tabs.find(tab => tab.id === section)?.id ?? 'overview';
      this.search = ''; this.source = ''; this.actor = ''; this.from = ''; this.to = '';
      this.offset = 0; this.notice = '';
      void this.load();
    }));
    this.subscriptions.add(auth.appForeground$.subscribe(() => { if (!this.loading && !this.pending) void this.load(); }));
  }

  async load(): Promise<void> {
    const version = ++this.requestVersion;
    this.loading = true; this.error = '';
    this.users = []; this.posts = []; this.events = []; this.stats = {}; this.total = 0;
    try {
      if (this.section === 'overview') {
        const stats = await this.admin.rpc<Record<string, number>>('admin_overview');
        if (version === this.requestVersion) this.stats = stats;
      } else {
        if (this.actor && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(this.actor)) throw new Error('Enter a valid user UUID.');
        if (this.from && this.to && this.from > this.to) throw new Error('The end date must be on or after the start date.');
        const data = await this.admin.rpc<AdminPage<AdminUser | AdminPost | ActivityEvent>>('admin_list', {
          p_section: this.section, p_search: this.search.trim(), p_offset: this.offset, p_limit: this.pageSize,
          p_source: this.source, p_actor: this.actor || null,
          p_from: this.from ? new Date(this.from + 'T00:00:00Z').toISOString() : null,
          p_to: this.to ? new Date(new Date(this.to + 'T00:00:00Z').getTime() + 86400000).toISOString() : null
        });
        if (version !== this.requestVersion) return;
        this.total = data.total;
        if (this.section === 'users') this.users = data.rows as AdminUser[];
        if (this.section === 'posts') this.posts = data.rows as AdminPost[];
        if (this.section === 'activity') this.events = data.rows as ActivityEvent[];
      }
    } catch (error) {
      if (version === this.requestVersion) this.error = error instanceof Error ? error.message : 'Unable to load admin data.';
    } finally { if (version === this.requestVersion) this.loading = false; }
  }

  applyFilters(): void { this.offset = 0; void this.load(); }
  page(direction: number): void { this.offset = Math.max(0, this.offset + direction * this.pageSize); void this.load(); }
  get pageEnd(): number { return Math.min(this.offset + this.pageSize, this.total); }

  openDelete(kind: 'user' | 'post', id: string, label: string): void {
    this.opener = document.activeElement as HTMLElement;
    this.pending = { kind, id, label };
    this.reason = ''; this.confirmation = ''; this.deleteError = '';
    this.dialog?.nativeElement.showModal();
  }
  closeDelete(): void {
    if (this.deleting) return;
    this.dialog?.nativeElement.close(); this.pending = null; this.opener?.focus();
  }
  onCancel(event: Event): void { event.preventDefault(); this.closeDelete(); }

  async confirmDelete(): Promise<void> {
    if (!this.pending || this.deleting || this.confirmation !== 'DELETE' || this.reason.trim().length < 3) return;
    this.deleting = true; this.deleteError = '';
    try {
      await this.admin.rpc(`admin_delete_${this.pending.kind}`, { p_id: this.pending.id, p_reason: this.reason.trim() });
      this.notice = this.pending.kind === 'user' ? 'Account deleted.' : 'Post deleted.';
      this.deleting = false;
      this.closeDelete();
      this.offset = 0;
      await this.load();
    } catch (error) {
      this.deleteError = (error instanceof Error ? error.message : 'Deletion failed.') + ' Refresh the list before retrying if the connection was interrupted.';
    } finally { this.deleting = false; }
  }

  ngOnDestroy(): void { this.requestVersion++; this.subscriptions.unsubscribe(); this.dialog?.nativeElement.close(); }
}

@Component({
  standalone: true, imports: [RouterLink],
  template: `<h1 class="h4">Admin access</h1><p role="alert">{{ message }}</p><a routerLink="/admin" class="btn btn-outline-primary">Try again</a>`
})
export class AdminAccessComponent {
  readonly message: string;
  constructor(route: ActivatedRoute) {
    this.message = route.snapshot.queryParamMap.has('unavailable')
      ? 'Unable to verify admin access. Check your connection and the admin database migration.'
      : 'Administrator access is required to view this page.';
  }
}
