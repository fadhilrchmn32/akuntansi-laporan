# SETUP_AND_CUTOVER — App 3 (Akuntansi & Laporan)

Panduan deployment produksi, konfigurasi Supabase bersama, migrasi database, worker terjadwal, serta prosedur cutover saldo awal (awal tahun maupun pertengahan tahun).

---

## 1. Prasyarat Lingkungan (`FINOPS_SHARED_V1`)
1. Gunakan **proyek Supabase yang sama** dengan App 1 dan App 2.
2. Variabel lingkungan klien (`.env`):
   - `VITE_SUPABASE_URL` — URL proyek Supabase bersama
   - `VITE_SUPABASE_ANON_KEY` — Publishable anon key proyek Supabase bersama
   - `VITE_ENABLE_DEMO_MODE` — Set `false` di produksi (`true` hanya untuk demo lokal tanpa Supabase)
3. Variabel lingkungan server worker (`worker/accounting-worker.ts`, **JANGAN pernah diekspos ke browser**):
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `FINOPS_COMPANY_ID` (opsional, jika dikosongkan worker memproses seluruh perusahaan aktif)

---

## 2. Urutan Migrasi Database Produksi vs UAT
Jalankan migrasi secara berurutan pada Supabase PostgreSQL:
1. Migrasi Fondasi App 1 & App 2 (`0001` s.d. `0004`).
2. Migrasi App 3 (Additive-Only):
   - `supabase/migrations/0005_finops_app3_accounting_engine.sql`
   - `supabase/migrations/0006_finops_app3_reports_and_views.sql`
   - `supabase/migrations/0007_finops_app3_worker_and_policies.sql`
   - `supabase/migrations/0008_finops_app3_domain_rpcs.sql`
3. **Seed UAT (KHUSUS STAGING/TEST — JANGAN DI PRODUKSI)**:
   - Jalankan `supabase/seed_uat_synthetic.sql` hanya pada lingkungan uji/UAT.

---

## 3. Pengaturan Worker Terjadwal (Outbox -> Jurnal)
App 3 mendukung dua opsi worker server-side (pilih salah satu atau gunakan `pg_cron` sebagai utama):
- **Opsi A — `pg_cron` PostgreSQL (Direkomendasikan)**:
  ```sql
  SELECT cron.schedule(
    'finops-accounting-worker',
    '*/2 * * * *',
    $$SELECT private.cron_process_all_companies();$$
  );
  ```
- **Opsi B — Node Server Worker (`worker/accounting-worker.ts`)**:
  Jalankan sebagai cron job / container terpisah:
  ```bash
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx worker/accounting-worker.ts
  ```
- Saat memproses antrean secara otomatis dari `pg_cron` atau `service_role`, `process_accounting_queue` mengaktifkan flag lokal transaksi `app3.worker_active = 'true'` agar `post_accounting_event` berjalan aman tanpa membutuhkan sesi browser.

---

## 4. Prosedur Cutover & Saldo Awal (Opening Balance)
1. **Inisialisasi COA & Periode**:
   - Panggil `initialize_default_coa(company_id)` dan sesuaikan kode/nama akun bila diperlukan sebelum transaksi berjalan.
   - Buat periode fiskal (mis. `2026-10` status `closed` sebagai titik cutover `31/10/2026`, dan `2026-11` status `open`).
2. **Input Saldo Awal (Balance Sheet Cutover)**:
   - Buka menu **Audit & Pengaturan -> Saldo Awal & Cutover**.
   - Masukkan saldo per akun (`Total Debit == Total Kredit`; sistem **menolak** pengajuan jika tidak seimbang dan tidak membuat akun plug otomatis).
   - Lengkapi rincian **Subledger Pembuka** (`ar_invoice`, `ap_invoice`, `customer_deposit`, `custody`, `inventory_sku` lengkap dengan kuantitas & harga pokok rata-rata awal, `fixed_asset`, `loan`) agar total masing-masing subledger sama persis dengan saldo kontrol (`1104`, `2101`, `2102`, `1102`, `1105`).
3. **Cutover Pertengahan Tahun (*Mid-Year Cutover*)**:
   - Centang `is_midyear_cutover = true` dan tentukan `cutover_date`.
   - Lengkapi saldo YTD histori (`ytd_hist_status`: `pending` -> `verified`) bila laporan Laba Rugi setahun penuh diperlukan; selama berstatus `pending`, laporan menandai cakupan YTD sebelum tanggal cutover secara jujur sebagai `Draft` / catatan kaki ketidaklengkapan.
4. **Persetujuan Dua Orang (Maker-Checker)**:
   - `accountant` mengajukan via `submit_opening_balance`, lalu `accounting_approver` berbeda menyetujui via `approve_opening_balance`.

---

## 5. Daftar Kesenjangan Konfigurasi Eksplisit (Harus Ditetapkan Sebelum Produksi)
- **Kerangka Pelaporan (SAK)**: Default **`Belum ditetapkan`** (`reporting_framework_status = 'unconfigured'`). Tetapkan bersama akuntan perusahaan di menu **Audit & Pengaturan** sebelum menerbitkan laporan `Final Internal`.
- **Kebijakan Pajak (PKP vs Non-PKP)**: Default **`Belum ditetapkan`** (`tax_policy_status = 'unconfigured'`). Kode pajak awal dalam keadaan non-aktif (`is_active = false`).
- **Auto-Post Deterministik**: Default **`false`** (event menjadi draft jurnal untuk review). Hanya `accounting_approver` yang dapat mengaktifkannya setelah `opening_status = 'approved'`.
- **Integrasi Pajak Eksternal / Audit Eksternal**: Aplikasi tidak menyertakan integrasi e-Faktur/Coretax dan tidak mengklaim laporan telah diaudit auditor independen.
