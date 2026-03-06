import { createClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

const inMemoryLocks = new Map<string, Promise<void>>();

async function lockInternally<T>(name: string, _acquireTimeout: number, fn: () => Promise<T>): Promise<T> {
  const prior = inMemoryLocks.get(name) ?? Promise.resolve();

  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });

  inMemoryLocks.set(name, prior.then(() => current));
  await prior;

  try {
    return await fn();
  } finally {
    release();
    if (inMemoryLocks.get(name) === current) {
      inMemoryLocks.delete(name);
    }
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
    lock: lockInternally
  }
});
