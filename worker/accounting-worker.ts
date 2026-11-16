/**
 * FINOPS_SHARED_V1 — Shared Accounting Queue Worker
 *
 * Worker terjadwal server-side untuk memproses antrean `accounting_events`
 * menggunakan engine SQL `process_accounting_queue` yang sama dengan tombol UI.
 *
 * Jadwal yang disarankan: setiap 1–2 menit via cron / Cloud Scheduler / pg_cron.
 * Izin: hanya dijalankan di lingkungan server terpercaya dengan SUPABASE_SERVICE_ROLE_KEY.
 * JANGAN PERNAH mengimpor atau menjalankan file ini dari browser.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('[accounting-worker] SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib tersedia di environment server.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function runWorkerOnce(): Promise<void> {
  const { data: companies, error: compErr } = await supabase
    .from('companies')
    .select('id, code, name')
    .eq('is_active', true);

  if (compErr) {
    throw new Error(`Gagal memuat daftar perusahaan: ${compErr.message}`);
  }

  for (const company of companies ?? []) {
    const { data, error } = await supabase.rpc('process_accounting_queue', {
      p_company_id: company.id,
      p_limit: 100,
    });

    if (error) {
      console.error(`[accounting-worker] Error pada ${company.code}:`, error.message);
    } else {
      console.info(`[accounting-worker] ${company.code} selesai:`, JSON.stringify(data));
    }
  }
}

runWorkerOnce().catch((err) => {
  console.error('[accounting-worker] Fatal:', err);
  process.exit(1);
});
