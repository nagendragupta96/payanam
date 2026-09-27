import { fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { Router } from '@angular/router';
import { BehaviorSubject, Subject } from 'rxjs';
import { Session } from '@supabase/supabase-js';
import { ActivityService } from './activity.service';
import { AuthService } from './auth.service';
import { supabase } from './supabase-client';
import { activityFetch, setApiActivityListener } from './activity-transport';

describe('Activity HTTP transport', () => {
  afterEach(() => setApiActivityListener());

  it('does not expose tokens, query values, body or response to the listener', async () => {
    const complete = jasmine.createSpy();
    const listener = jasmine.createSpy().and.returnValue(complete);
    setApiActivityListener(listener);
    spyOn(window, 'fetch').and.resolveTo(new Response('{}'));
    await activityFetch('https://example.invalid/rest/v1/profiles?email=SECRET', {
      method: 'PATCH', headers: { Authorization: 'SECRET TOKEN' }, body: 'SECRET BODY'
    });
    expect(listener).toHaveBeenCalledOnceWith('PATCH:/rest/v1/profiles');
    expect(complete).toHaveBeenCalledOnceWith(true);
  });

  it('never recursively records its ingestion endpoint', async () => {
    const listener = jasmine.createSpy();
    setApiActivityListener(listener);
    spyOn(window, 'fetch').and.resolveTo(new Response('{}'));
    await activityFetch('https://example.invalid/rest/v1/rpc/record_client_activity');
    expect(listener).not.toHaveBeenCalled();
  });

  it('telemetry errors cannot prevent the underlying request', async () => {
    setApiActivityListener(() => { throw new Error('telemetry failure'); });
    spyOn(window, 'fetch').and.resolveTo(new Response('{}'));
    expect((await activityFetch('https://example.invalid/rest/v1/profiles')).ok).toBeTrue();
  });

  it('reports failure without swallowing the original network error', async () => {
    const complete = jasmine.createSpy();
    setApiActivityListener(() => complete);
    const error = new Error('offline');
    spyOn(window, 'fetch').and.rejectWith(error);
    await expectAsync(activityFetch('https://example.invalid/rest/v1/profiles')).toBeRejectedWith(error);
    expect(complete).toHaveBeenCalledOnceWith(false);
  });
});

describe('Activity batching', () => {
  let service: ActivityService;
  let sessions: BehaviorSubject<Session | null>;
  let rpc: jasmine.Spy;
  let input: HTMLInputElement;
  const session = (id: string) => ({ user: { id } } as Session);

  beforeEach(() => {
    sessions = new BehaviorSubject<Session | null>(session('first'));
    rpc = spyOn(supabase, 'rpc').and.returnValue({ abortSignal: () => Promise.resolve({ error: null }) } as any);
    service = new ActivityService({ session$: sessions.asObservable() } as AuthService,
      { events: new Subject(), url: '/search?query=SECRET' } as unknown as Router);
    input = document.createElement('input');
    input.id = 'searchControl'; input.value = 'SECRET VALUE';
    document.body.append(input);
  });
  afterEach(() => { service.ngOnDestroy(); input.remove(); });
  const interact = (input: HTMLInputElement) => input.dispatchEvent(new Event('change', { bubbles: true }));

  it('batches semantic actions without field values or URL parameters', fakeAsync(() => {
    interact(input); interact(input);
    expect(rpc).not.toHaveBeenCalled();
    tick(1000); flushMicrotasks();
    expect(rpc).toHaveBeenCalledOnceWith('record_client_activity', { p_events: [
      { action: 'change', area: 'search', control: 'searchControl' },
      { action: 'change', area: 'search', control: 'searchControl' }
    ] });
  }));

  it('drops pending old-account events on identity change', fakeAsync(() => {
    interact(input);
    sessions.next(session('second'));
    tick(1000); flushMicrotasks();
    expect(rpc).not.toHaveBeenCalled();
  }));

  it('aborts an in-flight batch when the account changes', fakeAsync(() => {
    let signal: AbortSignal | undefined;
    rpc.and.returnValue({ abortSignal: (value: AbortSignal) => { signal = value; return Promise.resolve({ error: null }); } } as any);
    interact(input); tick(1000);
    sessions.next(null);
    expect(signal?.aborted).toBeTrue();
  }));

  it('bounds hung auth/request waits and continues collecting after failure', fakeAsync(() => {
    rpc.and.returnValue({ abortSignal: () => new Promise(() => undefined) } as any);
    spyOn(console, 'warn'); spyOn(console, 'error');
    interact(input); tick(1000); tick(5000); flushMicrotasks();
    rpc.and.returnValue({ abortSignal: () => Promise.resolve({ error: null }) } as any);
    interact(input); tick(2000); flushMicrotasks();
    expect(rpc).toHaveBeenCalledTimes(2);
  }));

  it('removes listeners and timers on destruction', fakeAsync(() => {
    interact(input); service.ngOnDestroy(); interact(input);
    tick(1000); flushMicrotasks();
    expect(rpc).not.toHaveBeenCalled();
  }));
});
