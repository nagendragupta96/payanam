import { Injectable, OnDestroy } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from './auth.service';
import { runSupabaseQuery, supabase } from './supabase-client';
import { setApiActivityListener } from './activity-transport';

interface ClientActivity { action: string; area: string; control: string; }
const areas = new Set(['home', 'auth', 'profile', 'create-itinerary', 'edit-itinerary', 'my-trips',
  'search', 'itinerary', 'requests', 'messages', 'chat', 'notifications', 'settings', 'subscription', 'admin', 'admin-access']);

@Injectable({ providedIn: 'root' })
export class ActivityService implements OnDestroy {
  private readonly subscriptions = new Subscription();
  private queue: ClientActivity[] = [];
  private userId: string | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private sending = false;
  private destroyed = false;
  private failures = 0;
  private controller?: AbortController;

  constructor(private auth: AuthService, private router: Router) {
    this.subscriptions.add(auth.session$.subscribe(session => {
      const id = session?.user.id ?? null;
      if (id !== this.userId) { this.controller?.abort(); this.queue = []; this.userId = id; this.failures = 0; }
    }));
    this.subscriptions.add(router.events.subscribe(event => {
      if (event instanceof NavigationEnd) this.record('navigation');
    }));
    setApiActivityListener(operation => {
      const actor = this.userId;
      this.record('api.start', operation);
      return success => { if (actor === this.userId) this.record(success ? 'api.success' : 'api.error', operation); };
    });
    for (const name of ['click', 'change', 'submit']) document.addEventListener(name, this.onInteraction, true);
    document.addEventListener('visibilitychange', this.onVisibility);
    for (const name of ['focus', 'online', 'offline']) window.addEventListener(name, this.onWindowEvent);
  }

  private record(action: string, control = ''): void {
    if (!this.userId || this.destroyed) return;
    const route = this.router.url.split(/[/?#]/).filter(Boolean)[0] || 'home';
    this.queue.push({ action, area: areas.has(route) ? route : 'other', control: control.slice(0, 100) });
    // Bounded in-memory buffer, never stored on disk or shared across accounts.
    if (this.queue.length > 200) { this.queue.shift(); console.warn('[activity] Buffer full; oldest browser event dropped.'); }
    this.schedule();
  }

  private onInteraction = (event: Event): void => {
    if (!(event.target instanceof Element)) return;
    const target = event.target.closest('button,a,input,select,textarea,form,[role="tab"]');
    if (!target || target.closest('[inert], [aria-hidden="true"]')) return;
    // Static control IDs only. No values, labels, message text or URL parameters.
    const id = target.getAttribute('data-activity') || target.getAttribute('formcontrolname') || target.id;
    const control = id && /^[a-zA-Z][a-zA-Z_-]{0,60}$/.test(id) ? id
      : `${target.tagName.toLowerCase()}:${Array.from(document.querySelectorAll(target.tagName)).indexOf(target)}`;
    this.record(event.type, control);
  };
  private onVisibility = (): void => this.record(document.hidden ? 'hidden' : 'visible');
  private onWindowEvent = (event: Event): void => this.record(event.type);

  private schedule(): void {
    if (this.timer || this.sending || this.destroyed) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, Math.min(30000, 1000 * 2 ** this.failures));
  }

  private async flush(): Promise<void> {
    if (!this.userId || !this.queue.length || this.destroyed) return;
    const actor = this.userId;
    const events = this.queue.splice(0, 50);
    this.sending = true;
    this.controller = new AbortController();
    const timeout = setTimeout(() => this.controller?.abort(), 5000);
    try {
      const { error } = await runSupabaseQuery('activity.flush', supabase.rpc('record_client_activity', { p_events: events }).abortSignal(this.controller.signal), 5000);
      if (error) throw error;
      if (actor === this.userId) this.failures = 0;
    } catch {
      // Retrying an uncertain write could duplicate events. Drop this batch and
      // back off subsequent batches, without changing auth or blocking the app.
      if (actor === this.userId) this.failures = Math.min(this.failures + 1, 5);
      console.warn('[activity] Browser activity batch could not be recorded.');
    } finally {
      clearTimeout(timeout);
      this.sending = false;
      if (this.queue.length) this.schedule();
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.subscriptions.unsubscribe();
    clearTimeout(this.timer);
    this.controller?.abort();
    setApiActivityListener();
    for (const name of ['click', 'change', 'submit']) document.removeEventListener(name, this.onInteraction, true);
    document.removeEventListener('visibilitychange', this.onVisibility);
    for (const name of ['focus', 'online', 'offline']) window.removeEventListener(name, this.onWindowEvent);
  }
}
