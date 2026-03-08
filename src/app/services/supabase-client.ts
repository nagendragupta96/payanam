import { createClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

const inMemoryLockTails = new Map<string, Promise<void>>();

async function withInMemoryLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const previous = inMemoryLockTails.get(name) ?? Promise.resolve();

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  inMemoryLockTails.set(name, tail);

  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (inMemoryLockTails.get(name) === tail) {
      inMemoryLockTails.delete(name);
    }
  }
}

async function safeAuthLock<T>(name: string, _acquireTimeout: number, fn: () => Promise<T>): Promise<T> {
  if (typeof window === 'undefined') {
    return await fn();
  }

  const lockManager = window.navigator?.locks;
  if (!lockManager?.request) {
    return await withInMemoryLock(name, fn);
  }

  try {
    return await lockManager.request(name, { mode: 'exclusive' }, async () => await fn());
  } catch (error) {
    console.warn('[supabase-lock] navigator lock failed; falling back to in-memory lock', { name, error });
    return await withInMemoryLock(name, fn);
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
    lock: safeAuthLock
  }
});
