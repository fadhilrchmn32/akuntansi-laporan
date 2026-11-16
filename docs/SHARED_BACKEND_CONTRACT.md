# SHARED_BACKEND_CONTRACT — FINOPS_SHARED_V1 (Diperbarui untuk App 1 + App 2 + App 3)

Versi Kontrak: `1.0.0` · Tanggal Pembaruan: `16 November 2026`  
Pemilik Fondasi: **App 1 — Penerimaan & Setoran**  
Pengguna Kontrak: **App 1 (Penerimaan & Setoran)**, **App 2 (Penjualan & Rekonsiliasi)**, **App 3 (Akuntansi & Laporan)**

---

## 1. Prinsip Arsitektur Bersama
1. **Satu Proyek Supabase Bersama**: App 1, App 2, dan App 3 wajib terhubung ke URL proyek Supabase, `company_id`, `branch_id`, Supabase Auth, dan private bucket `finops-evidence` yang sama.
2. **Migrasi Additive-Only**: Perubahan skema lintas app hanya melalui file migrasi bernomor unik pada `supabase/migrations/` (`0001`–`0008`) dan dicatat di `public.schema_migrations`. Dilarang menjalankan `DROP`, `TRUNCATE`, atau membuat tabel duplikat per aplikasi.
3. **Presisi Desimal**:
   - Nilai uang: `NUMERIC(20,2)` (IDR default tanpa pecahan, pembulatan `half_up`).
   - Kuantitas & harga satuan: `NUMERIC(20,6)`.
   - Pertukaran API/RPC memakai string desimal atau `NUMERIC` PostgreSQL. Hitungan otoritatif berada di PostgreSQL, bukan floating-point JavaScript; TypeScript menggunakan `Decimal.js` (`ROUND_HALF_UP`).
4. **Identitas & Tanggal Terpisah**:
   - `customers.cust_id` bertipe `TEXT` agar nol awal (`00104`) tidak hilang.
   - Tanggal operasional (`customer_paid_at`, `bank_value_date`, `deposit_date`, `invoice_date`, `delivery_date`, `accounting_date`, `effective_date`) disimpan sebagai `DATE` (`YYYY-MM-DD`); waktu audit disimpan sebagai `TIMESTAMPTZ` (tampilan UI WIB `Asia/Jakarta`).

## 2. Pendaftaran Migrasi Kanonis (`FINOPS_SHARED_V1`)
| Nomor | File Migrasi | Pemilik | Ruang Lingkup |
| :--- | :--- | :--- | :--- |
| `0001` | `0001_finops_shared_v1_foundation.sql` | App 1 | Fondasi seluruh tabel kanonis lintas App 1/2/3 |
| `0002` | `0002_finops_shared_v1_rls_security.sql` | App 1 | RLS & helper keamanan (`has_branch_access`, `has_branch_role`, `assert_maker_checker`) + storage `finops-evidence` |
| `0003` | `0003_finops_app1_rpcs.sql` | App 1 | RPC penerimaan, setoran, transfer internal, bank matching, outbox event |
| `0004` | `0004_finops_app2_views_and_realtime.sql` | App 2 | View `v_app2_allocatable_receipts` & publikasi Realtime App 1/2 |
| `0005` | `0005_finops_app3_accounting_engine.sql` | **App 3** | Kebijakan akuntansi, perluasan ledger, trigger imutabilitas jurnal, `post_accounting_event`, `approve_manual_journal`, `reverse_journal`, `close_fiscal_period`, `reopen_fiscal_period` |
| `0006` | `0006_finops_app3_reports_and_views.sql` | **App 3** | `process_accounting_queue`, `create_manual_journal`, `post_goods_receipt`, `v_app3_trial_balance_posted` (`security_invoker = true`), publikasi Realtime App 3 |
| `0007` | `0007_finops_app3_worker_and_policies.sql` | **App 3** | Helper `private.cron_process_all_companies()` untuk `pg_cron` dan `initialize_default_coa()` |
| `0008` | `0008_finops_app3_domain_rpcs.sql` | **App 3** | Kolom `paid_amount`, `invoiced_status`, `total_estimated_cost`, tabel `loan_repayments`, dan seluruh RPC transaksional domain App 3 |

## 3. Handoff Event Lintas Aplikasi (`accounting_events`)
- **App 1 -> App 3**:
  - `receipt_transfer_verified` -> `1103 Bank` (+ `6109 Biaya Bank` jika ditanggung perusahaan) vs `2102 Titipan Pelanggan` (`operating`)
  - `receipt_cash_verified` -> `1102 Kas di Penagih` vs `2102 Titipan Pelanggan` (`operating`)
  - `receipt_unidentified_verified` -> `1103 Bank` vs `2103 Penerimaan Belum Teridentifikasi` (`unclassified`)
  - `receipt_identity_resolved` -> `2103` vs `2102` (`non_cash`)
  - `cash_deposit_office_accepted` -> `1101 Kas Kantor` vs `1102 Kas di Penagih` (`internal_transfer`)
  - `cash_deposit_direct_bank_accepted` -> `1103 Bank` vs `1102 Kas di Penagih` (`internal_transfer`)
  - `internal_fund_transfer_approved` -> `1103 Bank Tujuan` vs `1101/1103 Asal` (`internal_transfer`)
- **App 2 -> App 3**:
  - `sales_delivery_recognized` -> `1104 Piutang Usaha` vs `4101 Penjualan` (+ `2105 Pajak Keluaran` jika aktif) serta `5101 HPP` vs `1105 Persediaan` (`non_cash`). **Ditolak/ditahan** jika barang stok tidak memiliki HPP atau stok tidak mencukupi.
  - `payment_allocated` -> `2102 Titipan Pelanggan` vs `1104 Piutang Usaha` (`non_cash`, bukan arus kas masuk baru).
- **App 3 Internal**:
  - `goods_receipt_posted` -> `1105 Persediaan` vs `2106 GRNI` (`non_cash`)
  - `purchase_invoice_approved` -> `2106 GRNI` (jika linked GRN) / `1105 Persediaan` / `1106 Uang Muka` vs `2101 Utang Usaha` (`non_cash`)
  - `supplier_payment_approved` -> `2101 Utang Usaha` vs `1101/1103 Kas/Bank` (`operating`)
  - `expense_approved` -> `direct_paid` (`6xxx` vs Kas/Bank, `operating`), `accrued` (`6xxx` vs `2107`, `non_cash`), `accrual_settlement` (`2107` vs Kas/Bank, `operating`), `prepaid` (`1106` vs Kas/Bank, `operating`)

## 4. Aturan Konsistensi Laporan & Kebijakan
1. Laporan keuangan menandai status **`Draft`** jika masih ada event `waiting_accounting_module`/`queued`/`draft_journal`/`failed`, jurnal berstatus `draft`, atau selisih tie-out kontrol vs subledger.
2. Status kerangka pelaporan (SAK) & status pajak (PKP/Non-PKP) tampil eksplisit **`Belum ditetapkan`** sampai disetujui melalui `update_accounting_policy`.
3. Tidak ada laporan yang mengklaim kepatuhan SAK otomatis, integrasi e-Faktur/Coretax, atau status telah diaudit eksternal.
