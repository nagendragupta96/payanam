import { createClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

async function safeAuthLock<T>(name: string, _acquireTimeout: number, fn: () => Promise<T>): Promise<T> {
  if (typeof window === 'undefined') {
    return await fn();
  }

  const lockManager = window.navigator?.locks;
  if (!lockManager?.request) {
    return await fn();
  }

  try {
    // Non-blocking lock attempt so a busy/stale browser lock never breaks auth flows.
    return await lockManager.request(name, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
      if (!lock) {
        return await fn();
      }

      return await fn();
    });
  } catch (error) {
    console.warn('[supabase-lock] navigator lock failed; continuing without lock', { name, error });
    return await fn();
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
