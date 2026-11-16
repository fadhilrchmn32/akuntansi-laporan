# RLS_ACCESS_MATRIX_APP3 — App 3 (Akuntansi & Laporan)

Seluruh tabel App 3 (baik tabel fondasi di `0001` maupun tabel tambahan di `0005` & `0008`: `accounting_policies`, `inventory_revaluations`, `worker_runs`, `loan_repayments`) mengaktifkan `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`.

- Hak akses `PUBLIC` dan `anon` dicabut penuh.
- Klien `authenticated` hanya diberi `SELECT` sesuai kebijakan RLS; seluruh mutasi `INSERT` / `UPDATE` / `DELETE` dicabut (`REVOKE INSERT, UPDATE, DELETE`) dan wajib melalui RPC `SECURITY DEFINER`.
- View pelaporan `public.v_app3_trial_balance_posted` menggunakan `WITH (security_invoker = true)` sehingga RLS tetap berlaku pada pembacaan agregasi neraca saldo.

---

## Matriks Hak Akses Menu & Tabel App 3 per Peran

| Peran (`role_code`) | Ruang Lingkup Cabang | Akses Menu App 3 | Mutasi Jurnal / Event | Pembelian, Stok, Biaya, Aset, Pinjaman | Tutup Buku & Kebijakan Kritis |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `accountant` | Sesuai `memberships` (company + branch) | Semua 17 menu | Proses antrean, buat draft jurnal manual/penyesuaian | Input GRN, draft invoice beli, bayar pemasok, revaluasi stok, draft biaya, aset tetap, penyusutan, pinjaman, ekuitas | Ajukan saldo awal, ubah kebijakan umum (bukan auto-post) |
| `accounting_approver` | Sesuai `memberships` | Semua 17 menu | Setujui/posting jurnal (`≠ created_by`), balik jurnal (`reverse_journal`) | Setujui invoice beli (`≠ maker`), setujui bayar pemasok (`≠ maker`), setujui biaya (`≠ maker`), seluruh aksi akuntan | Setujui saldo awal (`≠ submitter`), tutup periode, buka ulang periode (`≠ closed_by`), aktifkan `allow_auto_post_deterministic` |
| `finance_maker` | Sesuai `memberships` | `ringkasan`, `kas_bank`, `piutang_titipan`, `utang_pemasok`, `biaya` | **Tidak** | Buat draft pembayaran pemasok & draft dokumen biaya (hanya lihat dokumen yang diizinkan; `expense_documents` dibatasi per role) | **Tidak** |
| `finance_checker` | Sesuai `memberships` | `ringkasan`, `kas_bank`, `piutang_titipan`, `utang_pemasok`, `biaya` | **Tidak** | Setujui pembayaran pemasok & biaya (`≠ maker`), setujui rekonsiliasi bank | **Tidak** |
| `sales_admin` | Sesuai `memberships` | `ringkasan`, `piutang_titipan` (read-only) | **Tidak** | **Tidak** (ditolak RLS pada `expense_documents`, `journal_entries` cabang lain) | **Tidak** |
| `reconciliation_reviewer` | Sesuai `memberships` | `ringkasan`, `piutang_titipan` | **Tidak** | Setujui rekonsiliasi bank | **Tidak** |
| `owner_viewer` | Sesuai `memberships` | `ringkasan`, `jurnal`, `buku_besar`, `neraca_saldo`, `piutang_titipan`, `kas_bank`, `laporan`, `audit_pengaturan` (semua **read-only**) | **Tidak** | Lihat laporan & snapshot | **Tidak** |
| `system_admin` | Company | `ringkasan`, `audit_pengaturan` | Proses antrean teknis saja (bukan approval jurnal manual) | **Tidak** untuk transaksi operasional kecuali audit/konfigurasi | Kelola cabang, pengguna, URL lintas app, kebijakan teknis |
| `collector_optional` | Hanya miliknya | **Ditolak** (fokus App 1) | **Ditolak** | **Ditolak** | **Ditolak** |
| `anonymous` | Tidak ada | **Ditolak penuh** | **Ditolak** | **Ditolak** | **Ditolak** |

---

## Pembatasan Tabel Sensitif (`0005` & `0008`)
- `public.expense_documents`: kebijakan `expense_documents_select` hanya mengizinkan role `accountant`, `accounting_approver`, `finance_checker`, `owner_viewer`, `system_admin` (mencegah `sales_admin` dan `collector_optional` membaca rincian biaya operasional/gaji).
- `public.journal_entries` & `public.journal_lines`: dilindungi oleh trigger `private.guard_immutable_journal()` dan `private.guard_immutable_journal_line()` sehingga baris berstatus `posted` atau `reversed` tidak dapat diedit/dihapus bahkan oleh `service_role` atau SQL langsung, kecuali transisi sah `posted -> reversed` dengan mengisi `reversed_by_id`.
- Private Bucket `finops-evidence`: pembacaan lampiran di `SourceDrawer` wajib meminta short-lived Signed URL via Supabase Storage setelah verifikasi keanggotaan `company_id`.
