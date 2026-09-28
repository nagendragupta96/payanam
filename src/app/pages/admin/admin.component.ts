import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideAngularModule, RefreshCw, Search, Trash2, ChevronLeft, ChevronRight, X, Activity } from 'lucide-angular';
import { combineLatest, Subscription } from 'rxjs';
import { AdminPage, AdminPost, AdminSection, AdminService, AdminUser, ActivityEvent } from '../../services/admin.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-admin', standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, LucideAngularModule],
  templateUrl: './admin.component.html', styleUrl: './admin.component.css'
})
export class AdminComponent implements OnDestroy {
  readonly icons = { RefreshCw, Search, Trash2, ChevronLeft, ChevronRight, X, Activity };
  readonly tabs: { id: AdminSection; label: string }[] = [
    { id: 'overview', label: 'Overview' }, { id: 'users', label: 'Users' },
    { id: 'posts', label: 'Posts' }, { id: 'activity', label: 'Activity' },
    { id: 'user-activity', label: 'User Activity' }
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

  constructor(public admin: AdminService, public auth: AuthService, route: ActivatedRoute, private router: Router) {
    this.subscriptions.add(combineLatest([route.paramMap, route.queryParamMap]).subscribe(([params, query]) => {
      const section = params.get('section');
      this.section = this.tabs.find(tab => tab.id === section)?.id ?? 'overview';
      this.search = query.get('search') ?? '';
      this.source = query.get('source') ?? '';
      this.actor = this.section === 'user-activity' ? (query.get('user') ?? '') : '';
      this.from = query.get('from') ?? ''; this.to = query.get('to') ?? '';
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
        if (this.isActivitySection) this.events = data.rows as ActivityEvent[];
      }
    } catch (error) {
      if (version === this.requestVersion) this.error = error instanceof Error ? error.message : 'Unable to load admin data.';
    } finally { if (version === this.requestVersion) this.loading = false; }
  }

  applyFilters(): void { this.offset = 0; void this.load(); }
  page(direction: number): void { this.offset = Math.max(0, this.offset + direction * this.pageSize); void this.load(); }
  get pageEnd(): number { return Math.min(this.offset + this.pageSize, this.total); }
  get isActivitySection(): boolean { return this.section === 'activity' || this.section === 'user-activity'; }

  async viewUserActivity(user: AdminUser): Promise<void> {
    await this.router.navigate(['/admin', 'user-activity'], { queryParams: { user: user.id } });
  }

  activityTitle(event: ActivityEvent): string {
    const actor = this.personLabel(event.actor_display_name, event.actor_email, event.actor_id, 'System');
    const subject = this.personLabel(event.subject_display_name, event.subject_email, event.subject_user_id, 'recipient');
    const table = this.entityLabel(event.entity_type);
    const changed = this.changedFields(event).join(', ');
    switch (event.action) {
      case 'navigation': return `${actor} opened ${this.areaLabel(event)}.`;
      case 'click': return `${actor} clicked ${this.controlLabel(event)}${this.areaSuffix(event)}.`;
      case 'change': return `${actor} changed ${this.controlLabel(event)}${this.areaSuffix(event)}.`;
      case 'submit': return `${actor} submitted ${this.controlLabel(event)}${this.areaSuffix(event)}.`;
      case 'focus': return `${actor} returned to the app.`;
      case 'hidden': return `${actor} left the app window.`;
      case 'visible': return `${actor} returned to the app window.`;
      case 'online': return `${actor} came back online.`;
      case 'offline': return `${actor} went offline.`;
      case 'api.start': return `${actor} started a data request${this.areaSuffix(event)}.`;
      case 'api.success': return `${actor} completed a data request${this.areaSuffix(event)}.`;
      case 'api.error': return `${actor} hit a data request error${this.areaSuffix(event)}.`;
      case 'notification.available': return `A notification became available for ${subject}.`;
      case 'admin.overview': return `${actor} viewed admin overview stats.`;
      case 'admin.list': return `${actor} opened the ${this.detailText(event, 'section', 'admin')} admin list.`;
      case 'admin.delete_post': return `${actor} deleted a post.`;
      case 'admin.delete_user': return `${actor} deleted ${subject}'s account.`;
    }

    const [entity, operation] = event.action.split('.');
    if (operation === 'insert') return `${actor} created ${this.entityLabel(entity)}.`;
    if (operation === 'delete') return `${actor} deleted ${this.entityLabel(entity)}.`;
    if (operation === 'update') return `${actor} updated ${this.entityLabel(entity)}${changed ? ` (${changed})` : ''}.`;
    return `${actor} performed ${event.action}.`;
  }

  activityMeta(event: ActivityEvent): string {
    const parts = [
      this.sourceLabel(event.source),
      event.actor_is_admin ? 'Admin action' : '',
      event.entity_id ? `${this.entityLabel(event.entity_type)} ${event.entity_id}` : '',
      event.subject_user_id ? `User ${event.subject_user_id}` : ''
    ].filter(Boolean);
    return parts.join(' · ');
  }

  activityDetail(event: ActivityEvent): string {
    if (event.action === 'admin.delete_post' || event.action === 'admin.delete_user') {
      return `Reason: ${this.detailText(event, 'reason', 'Not provided')}`;
    }
    if (event.action === 'notifications.insert') {
      return `Notification type: ${this.detailText(event, 'notification_type', 'General')}`;
    }
    if (event.action === 'notifications.update' && Object.prototype.hasOwnProperty.call(event.details ?? {}, 'is_read')) {
      return `Notification marked ${event.details['is_read'] ? 'read' : 'unread'}.`;
    }
    const status = this.detailText(event, 'status', '');
    const previousStatus = this.detailText(event, 'previous_status', '');
    if (status && previousStatus && status !== previousStatus) return `Status changed from ${previousStatus} to ${status}.`;
    if (status) return `Status: ${status}.`;
    const changed = this.changedFields(event);
    if (changed.length) return `Changed fields: ${changed.join(', ')}.`;
    return '';
  }

  private personLabel(name: string | null | undefined, email: string | null | undefined, id: string | null | undefined, fallback: string): string {
    return name || email || id || fallback;
  }

  private entityLabel(value: string | null | undefined): string {
    const labels: Record<string, string> = {
      users: 'account', profiles: 'profile', itineraries: 'post', itinerary_legs: 'itinerary leg',
      itinerary_contact_details: 'contact details', requests: 'request', chat_threads: 'conversation',
      chat_messages: 'message', subscriptions: 'subscription', subscription_checkouts: 'checkout',
      notifications: 'notification', app_admins: 'admin role', sessions: 'session'
    };
    return labels[value ?? ''] ?? (value || 'record');
  }

  private sourceLabel(value: string): string {
    return value === 'client' ? 'Browser activity' : value === 'admin' ? 'Admin console' : 'Database';
  }

  private areaLabel(event: ActivityEvent): string {
    return this.detailText(event, 'area', 'the app');
  }

  private areaSuffix(event: ActivityEvent): string {
    const area = this.detailText(event, 'area', '');
    return area ? ` in ${area}` : '';
  }

  private controlLabel(event: ActivityEvent): string {
    return this.detailText(event, 'control', 'a control');
  }

  private detailText(event: ActivityEvent, key: string, fallback: string): string {
    const value = event.details?.[key];
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
  }

  private changedFields(event: ActivityEvent): string[] {
    const value = event.details?.['changed_fields'];
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  }

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
