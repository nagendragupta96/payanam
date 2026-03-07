import { createClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

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

// Use Supabase's default browser auth locking behavior.
// The previous custom in-memory lock could stall during tab/window switching and trigger
// lock hold timeout warnings followed by auth foreground timeout failures.
export const supabase = createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});
