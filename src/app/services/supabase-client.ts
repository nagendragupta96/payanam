import { createClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

const inMemoryLocks = new Map<string, Promise<void>>();
const defaultAcquireTimeoutMs = 4000;
const maxLockHoldMs = 12000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function lockInternally<T>(name: string, acquireTimeout: number, fn: () => Promise<T>): Promise<T> {
  const previous = inMemoryLocks.get(name) ?? Promise.resolve();

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);

  inMemoryLocks.set(name, tail);

  const effectiveAcquireTimeout = acquireTimeout > 0 ? acquireTimeout : defaultAcquireTimeoutMs;
  const acquired = await Promise.race([
    previous.then(() => true),
    wait(effectiveAcquireTimeout).then(() => false)
  ]);

  if (!acquired) {
    console.warn('[supabase-lock] acquire timeout; bypassing stalled lock', { name, acquireTimeout: effectiveAcquireTimeout });
  }

  let released = false;
  const safeRelease = () => {
    if (released) return;
    released = true;
    release();
    if (inMemoryLocks.get(name) === tail) {
      inMemoryLocks.delete(name);
    }
  };

  const releaseWatchdog = window.setTimeout(() => {
    console.warn('[supabase-lock] hold timeout; forcing lock release', { name, maxLockHoldMs });
    safeRelease();
  }, maxLockHoldMs);

  try {
    return await fn();
  } finally {
    window.clearTimeout(releaseWatchdog);
    safeRelease();
  }
}

function getSupabaseConfigIssue(): string | null {
  const url = environment.supabaseUrl?.trim() ?? '';
  const anonKey = environment.supabaseAnonKey?.trim() ?? '';

  if (!url || !anonKey) {
    return 'Supabase is not configured. Please set supabaseUrl and supabaseAnonKey in environment files.';
  }

  if (url.includes('YOUR_PROJECT_REF') || anonKey.includes('YOUR_SUPABASE_ANON_KEY')) {
    return 'Supabase is using placeholder credentials. Please update src/environments/environment.ts and src/environments/environment.prod.ts.';
  }

  return null;
}

export const supabaseConfigIssue = getSupabaseConfigIssue();
export const supabase = createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    lock: lockInternally
  }
});
