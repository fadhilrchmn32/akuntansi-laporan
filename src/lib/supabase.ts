import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? '';
const supabaseAnonKey =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim() ||
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ||
  '';

export const isSupabaseConfigured =
  supabaseUrl.length > 0 &&
  supabaseAnonKey.length > 0 &&
  !supabaseUrl.includes('YOUR_PROJECT_REF') &&
  !supabaseAnonKey.includes('YOUR_SUPABASE');

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null;

export function getEnvDiagnostics() {
  return {
    hasUrl: supabaseUrl.length > 0 && !supabaseUrl.includes('YOUR_PROJECT_REF'),
    hasKey: supabaseAnonKey.length > 0 && !supabaseAnonKey.includes('YOUR_SUPABASE'),
    urlPreview: supabaseUrl ? supabaseUrl.replace(/^(https:\/\/[^.]+).*/, '$1.***') : 'Belum diisi',
  };
}
