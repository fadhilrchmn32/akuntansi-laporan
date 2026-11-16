# UAT_TEST_PLAN — App 3 (Akuntansi & Laporan)

Rencana pengujian terintegrasi untuk memverifikasi ketepatan akuntansi double-entry, kendali akses (RLS & maker-checker), konsistensi subledger, dan laporan keuangan lintas App 1, App 2, dan App 3.

---

## A. Pengujian Unit Logika Mesin Akuntansi & Ekspor (Lokal Workspace)
Dijalankan dengan: `npx tsx --test tests/accounting-engine.test.ts`

| ID Uji | Skenario Pengujian | Ekspektasi Hasil |
| :--- | :--- | :--- |
| `UAT-UNIT-01` | Keseimbangan double-entry seluruh recipe event (`receipt_transfer_verified`, `receipt_cash_verified`, `receipt_unidentified_verified`, `receipt_identity_resolved`, `payment_allocated`, `cash_deposit_office_accepted`, `cash_deposit_direct_bank_accepted`, `internal_fund_transfer_approved`, `sales_delivery_recognized`, `goods_receipt_posted`, `purchase_invoice_approved`, `supplier_payment_approved`, `expense_approved`) | Setiap jurnal memiliki `total_debit === total_credit > 0` dan `cash_flow_category` yang sesuai. |
| `UAT-UNIT-02` | Idempotensi pemrosesan event & duplikasi `idempotency_key` | Pemanggilan ulang dengan event atau `idempotency_key` yang sama mengembalikan jurnal existing (`idempotentHit = true`) tanpa menggandakan jurnal. |
| `UAT-UNIT-03` | Penahanan penjualan barang stok dengan HPP nol / stok kosong (`ev-8` SKU `MYK-GRG-5L`) | Mesin menolak posting dan menahan event dengan error eksplisit (dilarang memposting HPP Rp 0). |
| `UAT-UNIT-04` | Eksklusi transfer internal custody/bank (`internal_transfer`) & alokasi titipan (`non_cash`) dari Arus Kas Metode Langsung | Setoran penagih ke kas kantor (`ev-5`) dan alokasi titipan ke nota (`ev-3`) tidak menggandakan arus kas operasi. |
| `UAT-UNIT-05` | Pelunasan invoice saldo awal (`provenance: 'opening'`) | Alokasi `ev-3` ke `OPN-INV-001` mendebit `2102` dan mengkredit `1104` tanpa mengakui ulang pendapatan `4101`. |
| `UAT-UNIT-06` | Penerimaan Barang (GRN) + Invoice Pemasok GRNI Clearing | GRN menambah `1105` & `2106`; approval invoice terhubung GRN mendebit `2106` & mengkredit `2101` tanpa menggandakan persediaan `1105`. |
| `UAT-UNIT-07` | Rekonsiliasi Laporan Neraca (`Aset === Liabilitas + Ekuitas`) & Arus Kas (`Kas Awal + Perubahan Bersih === Kas Akhir Neraca`) | Seluruh persamaan akuntansi nol selisih (`imbalanceDiff = 0.00`, `reconcilesWithBalanceSheet = true`). |
| `UAT-UNIT-08` | Isolasi laporan historis (`as-of` cut-off tanggal `2026-11-05` vs `2026-11-16`) | Laporan per `2026-11-05` tidak memasukkan transaksi setelah `2026-11-05` (mis. biaya BBM `2026-11-09`). |
| `UAT-UNIT-09` | Kunci periode fiskal tertutup (`2026-10` status `closed`) | Posting event ke tanggal di dalam periode `2026-10` ditolak oleh `assertOpenPeriod`. |
| `UAT-UNIT-10` | Proteksi CSV Formula Injection tanpa merusak nilai numerik | Sel teks berawalan `=`, `+`, `-`, `@` diberi prefiks apostrof (`'=...`), sedangkan angka negatif/desimal murni (`-1500000`, `12000000.00`) tetap berupa nilai numerik valid. |

---

## B. Pengujian Live Supabase SQL, RLS, Concurrency & Lintas Aplikasi (Staging DB)
Status saat penyerahan dari sandbox AI Studio: **Belum dijalankan** (kredensial Supabase live proyek bersama tidak tersedia di lingkungan sandbox ini).

### Cara Reproduksi Pengujian Live di Proyek Supabase Anda:
1. Terapkan migrasi `0001` s.d. `0008` ke proyek Supabase staging, lalu jalankan `supabase/seed_uat_synthetic.sql`.
2. Buat akun test pada Supabase Auth (`accountant`, `accounting_approver`, `finance_maker`, `finance_checker`, `sales_admin`, `owner_viewer`, `system_admin`) dan tambahkan `memberships` masing-masing.
3. Jalankan skenario berikut di UI Live Mode & SQL Editor:
   - **UAT-LIVE-01 (RLS & RBAC)**: Login sebagai `sales_admin` -> verifikasi query langsung ke `expense_documents` dan mutasi `INSERT/UPDATE/DELETE` langsung pada `journal_entries` ditolak oleh PostgreSQL RLS (`42501`).
   - **UAT-LIVE-02 (Imutabilitas Jurnal)**: Pada SQL Editor, coba `UPDATE public.journal_lines` atau `DELETE FROM public.journal_entries` untuk jurnal berstatus `posted` -> pastikan trigger `guard_immutable_journal` menolak.
   - **UAT-LIVE-03 (Proteksi Akun Kontrol)**: Panggil `create_manual_journal` dengan `p_journal_type = 'manual'` ke COA `1104` / `2101` / `1105` -> harus ditolak; ulangi dengan `subledger_adjustment` + `customer_id`/`supplier_id`/`product_id` -> berhasil sebagai `draft`, lalu setujui via `accounting_approver` berbeda (`≠ maker`).
   - **UAT-LIVE-04 (Lintas App 1 & App 2)**:
     1. Di App 1: Verifikasi receipt transfer & setoran tunai -> cek baris `accounting_events` masuk dengan status `waiting_accounting_module`.
     2. Jalankan `npx tsx worker/accounting-worker.ts` atau tunggu `pg_cron` -> verifikasi event berubah menjadi `draft_journal` / `posted`.
     3. Di App 2: Catat pengiriman nota berstok kosong -> verifikasi App 3 menahan event dengan status `failed`.
   - **UAT-LIVE-05 (Tutup & Buka Ulang Periode)**: Tutup periode `2026-11` -> simpan snapshot `final_internal` -> buka ulang via `reopen_fiscal_period` oleh approver berbeda -> verifikasi snapshot lama berubah menjadi `superseded`.
