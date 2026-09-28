import { CommonModule } from '@angular/common';
import { Component, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-angular';
import { Subscription } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { runSupabaseQuery, supabase } from '../../services/supabase-client';
import { PersonalActivity, personalActivityText } from '../../shared/activity-labels';

@Component({
  selector: 'app-activity', standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
  template: `
    <section aria-labelledby="activityHeading">
      <div class="d-flex align-items-center justify-content-between gap-3 mb-3">
        <h1 id="activityHeading" class="h4 mb-0">My Activity</h1>
        <button type="button" class="btn btn-outline-primary" title="Refresh" aria-label="Refresh" data-activity="refresh" [disabled]="loading" (click)="reset()">
          <lucide-icon [img]="RefreshCw" [size]="18"></lucide-icon>
        </button>
      </div>
      <div class="mb-3">
        <label for="activityCategory" class="form-label">Activity type</label>
        <select id="activityCategory" class="form-select category" [(ngModel)]="category" (ngModelChange)="reset()" [disabled]="loading">
          <option value="all">All activity</option><option value="actions">Actions</option><option value="notifications">Notifications</option>
        </select>
      </div>
      <div class="alert alert-danger" role="alert" *ngIf="error">
        {{ error }} <button class="btn btn-sm btn-outline-danger ms-2" type="button" data-activity="retry" (click)="load()">Retry</button>
      </div>
      <p *ngIf="loading" role="status">Loading your activity...</p>
      <p *ngIf="!loading && !error && !rows.length" role="status">No activity found.</p>
      <ol class="list-unstyled border-top" *ngIf="!loading && !error && rows.length">
        <li *ngFor="let row of rows" class="py-3 border-bottom activity-row">
          <p class="mb-1">{{ describe(row) }}</p>
          <div class="small text-secondary"><time [attr.datetime]="row.created_at">{{ row.created_at | date:'medium' }}</time> &middot; {{ sourceLabel(row) }}</div>
        </li>
      </ol>
      <div class="d-flex align-items-center justify-content-between gap-2 mt-3" *ngIf="!error">
        <button type="button" class="btn btn-outline-secondary" title="Previous page" aria-label="Previous page" data-activity="previous" [disabled]="loading || cursors.length === 1" (click)="previous()">
          <lucide-icon [img]="ChevronLeft" [size]="18"></lucide-icon>
        </button>
        <span>Page {{ cursors.length }}</span>
        <button type="button" class="btn btn-outline-secondary" title="Next page" aria-label="Next page" data-activity="next" [disabled]="loading || !hasMore" (click)="next()">
          <lucide-icon [img]="ChevronRight" [size]="18"></lucide-icon>
        </button>
      </div>
    </section>
  `,
  styles: [`.category { max-width: 22rem; } .activity-row { overflow-wrap: anywhere; }`]
})
export class ActivityComponent implements OnDestroy {
  readonly RefreshCw = RefreshCw; readonly ChevronLeft = ChevronLeft; readonly ChevronRight = ChevronRight;
  readonly describe = personalActivityText;
  rows: PersonalActivity[] = [];
  cursors: (number | null)[] = [null];
  category = 'all'; hasMore = false; loading = false; error = '';
  private userId: string | null = null;
  private generation = 0;
  private controller?: AbortController;
  private readonly subscriptions = new Subscription();

  constructor(private auth: AuthService) {
    this.subscriptions.add(auth.session$.subscribe(session => {
      const id = session?.user.id ?? null;
      if (id === this.userId) return;
      this.userId = id;
      this.generation++;
      this.controller?.abort();
      this.rows = []; this.loading = false; this.hasMore = false;
      if (id) this.reset();
    }));
    this.subscriptions.add(auth.appForeground$.subscribe(() => { if (!this.loading) this.reset(); }));
  }

  reset(): void { this.cursors = [null]; void this.load(); }
  next(): void { if (this.loading || !this.hasMore || !this.rows.length) return; this.cursors.push(this.rows[this.rows.length - 1].id); void this.load(); }
  previous(): void { if (this.loading || this.cursors.length === 1) return; this.cursors.pop(); void this.load(); }
  sourceLabel(row: PersonalActivity): string {
    return row.source === 'client' ? 'App activity' : row.source === 'admin' ? 'Administrator action' : 'Account activity';
  }

  async load(): Promise<void> {
    if (!this.userId || this.loading) return;
    const generation = ++this.generation;
    this.loading = true; this.error = '';
    const controller = new AbortController(); this.controller = controller;
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const { data, error } = await runSupabaseQuery('activity.list', supabase.rpc('my_activity', {
        p_before: this.cursors[this.cursors.length - 1], p_limit: 25, p_category: this.category
      }).abortSignal(controller.signal));
      if (generation !== this.generation) return;
      if (error) throw error;
      this.rows = data?.rows ?? []; this.hasMore = data?.has_more === true;
    } catch {
      if (generation === this.generation) { this.rows = []; this.error = 'Your activity could not be loaded. Please try again.'; }
    } finally {
      clearTimeout(timer);
      if (generation === this.generation) this.loading = false;
    }
  }

  ngOnDestroy(): void { this.generation++; this.controller?.abort(); this.subscriptions.unsubscribe(); }
}
