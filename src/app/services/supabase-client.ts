import { createClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

const inProcessLockQueues = new Map<string, Promise<unknown>>();

function makeLockTimeoutError(name: string, acquireTimeout: number): Error & { isAcquireTimeout: boolean } {
  const error = new Error(`Supabase auth lock acquisition timed out for ${name} after ${acquireTimeout}ms`) as Error & {
    isAcquireTimeout: boolean;
  };
  error.isAcquireTimeout = true;
  return error;
}

async function runWithInProcessLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const previous = inProcessLockQueues.get(name) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(fn);
  inProcessLockQueues.set(
    name,
    run.finally(() => {
      if (inProcessLockQueues.get(name) === run) {
        inProcessLockQueues.delete(name);
      }
    })
  );
  return run;
}

async function safeAuthLock<T>(name: string, _acquireTimeout: number, fn: () => Promise<T>): Promise<T> {
  if (typeof window === 'undefined') {
    return await fn();
  }

  const lockManager = window.navigator?.locks;
  if (!lockManager?.request) {
    console.debug('[supabase-lock] navigator locks unavailable; using in-process lock', { name });
    return await runWithInProcessLock(name, fn);
  }

  const acquireTimeout = Math.max(_acquireTimeout ?? 0, 0);
  const abortController = acquireTimeout > 0 ? new AbortController() : null;
  const timeoutId = abortController
    ? window.setTimeout(() => abortController.abort(makeLockTimeoutError(name, acquireTimeout)), acquireTimeout)
    : null;

  try {
    console.debug('[supabase-lock] acquire start', { name, acquireTimeout });
    const result = await lockManager.request(
      name,
      {
        mode: 'exclusive',
        ...(acquireTimeout === 0 ? { ifAvailable: true } : {}),
        ...(abortController ? { signal: abortController.signal } : {})
      } as LockOptions,
      async (lock) => {
      if (!lock) {
        throw makeLockTimeoutError(name, acquireTimeout);
      }

      return await fn();
      }
    );
    console.debug('[supabase-lock] acquire complete', { name });
    return result;
  } catch (error) {
    if (abortController?.signal.aborted || (error as any)?.name === 'AbortError') {
      console.warn('[supabase-lock] acquire timed out', { name, acquireTimeout });
      throw makeLockTimeoutError(name, acquireTimeout);
    }

    if ((error as any)?.isAcquireTimeout) {
      console.warn('[supabase-lock] acquire unavailable', { name, acquireTimeout });
      throw error;
    }

    console.warn('[supabase-lock] navigator lock failed; using in-process lock fallback', { name, error });
    return await runWithInProcessLock(name, fn);
  } finally {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
  }
}

export async function runSupabaseQuery<T>(operation: string, query: PromiseLike<T>, timeoutMs = 12000): Promise<T> {
  const startedAt = Date.now();
  let timeoutId: number | null = null;
  console.debug('[supabase-query] start', { operation });

  try {
    const result = await Promise.race([
      Promise.resolve(query),
      new Promise<T>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error(`Supabase query timed out: ${operation}`)), timeoutMs);
      })
    ]);
    const maybeResult = result as any;
    console.debug('[supabase-query] end', {
      operation,
      durationMs: Date.now() - startedAt,
      hasError: !!maybeResult?.error,
      count: Array.isArray(maybeResult?.data) ? maybeResult.data.length : undefined
    });
    return result;
  } catch (error) {
    console.error('[supabase-query] error', {
      operation,
      durationMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : String(error)
    });
    throw error;
  } finally {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
  }
}

export function dataFetchErrorMessage(operation: string, error: unknown): string {
  if (error instanceof Error && error.message.includes('timed out')) {
    return `${operation} timed out. Please try again.`;
  }

  return error instanceof Error ? error.message : `${operation} failed. Please try again.`;
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
