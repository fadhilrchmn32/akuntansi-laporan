# RPC_CONTRACT_APP3 — App 3 (Akuntansi & Laporan)

Seluruh RPC App 3 pada migrasi `0005`, `0006`, `0007`, dan `0008` berjalan sebagai `SECURITY DEFINER` (`SET search_path = ''`), mengaudit `auth.uid()` (kecuali `process_accounting_queue` saat dipanggil worker `pg_cron` / `service_role`), memeriksa `memberships`, mengunci baris dengan `FOR UPDATE`, menyimpan `idempotency_keys`, dan menulis `audit_events`.

---

## 1. Mesin Jurnal, Antrean & Periode (`0005`, `0006`, `0007`)

| Nama RPC | Peran Diizinkan | Parameter Utama | Validasi & Efek Atomik |
| :--- | :--- | :--- | :--- |
| `post_accounting_event` | `accountant`, `accounting_approver`, `system_admin`, atau worker terotorisasi (`app3.worker_active = 'true'`) | `p_idempotency_key`, `p_accounting_event_id`, `p_force_status` | Memeriksa `journal_source_links` & dependensi event, mengunci periode fiskal terbuka, menolak `sales_delivery_recognized` dengan HPP 0 untuk barang stok (`failed`), membentuk `journal_entries` (`draft` default atau `posted` jika `allow_auto_post_deterministic` + saldo awal disetujui atau `p_force_status = 'posted'`). |
| `process_accounting_queue` | `accountant`, `accounting_approver`, `system_admin`, atau `pg_cron`/`service_role` | `p_company_id`, `p_limit` | Memproses event `waiting_accounting_module` / `queued` secara berurutan per `effective_date`, mencatat log di `worker_runs`. |
| `create_manual_journal` | `accountant`, `accounting_approver` | `p_idempotency_key`, `p_company_id`, `p_branch_id`, `p_accounting_date`, `p_effective_date`, `p_description`, `p_journal_type`, `p_lines`, `p_reason` | Mengunci periode terbuka, memvalidasi minimal 2 baris & debit=kredit, menolak akun kontrol (`1102`, `1104`, `1105`, `2101`, `2102`, `2106`) untuk `journal_type = 'manual'` (wajib `subledger_adjustment` + UUID subledger). |
| `approve_manual_journal` | `accounting_approver` (≠ `created_by`) | `p_idempotency_key`, `p_journal_entry_id`, `p_expected_version` | Menegakkan maker-checker, optimistic locking `version`, mengubah `draft` -> `posted`. |
| `reverse_journal` | `accounting_approver` | `p_idempotency_key`, `p_journal_entry_id`, `p_reversal_date`, `p_reason` | Membuat jurnal pembalik `posted` baru (`reversal_of_id`), menandai jurnal asal `reversed` + `reversed_by_id` (tidak pernah menghapus/mengedit jurnal asal). |
| `close_fiscal_period` | `accounting_approver` | `p_idempotency_key`, `p_fiscal_period_id`, `p_expected_version` | Memblokir tutup buku jika masih ada jurnal tidak seimbang, event tertahan, atau stok negatif. |
| `reopen_fiscal_period` | `accounting_approver` (≠ `closed_by`) | `p_idempotency_key`, `p_fiscal_period_id`, `p_expected_version`, `p_reason` | Maker-checker, alasan minimal 10 karakter, menandai `report_snapshots` lama menjadi `superseded`. |
| `initialize_default_coa` | `accountant`, `accounting_approver`, `system_admin` | `p_company_id` | Mengisi template COA standar tanpa menimpa akun existing. |

---

## 2. Domain Pembelian, Persediaan, Biaya, Aset, Pinjaman & Ekuitas (`0006`, `0008`)

| Nama RPC | Peran Diizinkan | Parameter Utama | Efek & Validasi Kritis |
| :--- | :--- | :--- | :--- |
| `create_goods_receipt` | `accountant`, `accounting_approver` | `p_idempotency_key`, `p_company_id`, `p_branch_id`, `p_supplier_id`, `p_received_date`, `p_lines`, `p_notes` | Membuat draft GRN + `goods_receipt_lines` dengan faktor konversi satuan. |
| `post_goods_receipt` | `accountant`, `accounting_approver` | `p_idempotency_key`, `p_goods_receipt_id`, `p_expected_version` | Mengunci `inventory_valuations` (`FOR UPDATE`), memperbarui *moving weighted average*, menulis `inventory_movements`, memancarkan `goods_receipt_posted` (`1105` vs `2106 GRNI`). |
| `create_purchase_document` | `accountant`, `accounting_approver` | `p_idempotency_key`, `p_company_id`, `p_branch_id`, `p_supplier_id`, `p_invoice_date`, `p_due_date`, `p_goods_receipt_id`, `p_is_prepayment_exception`, `p_freight_amount`, `p_lines`, `p_notes` | Membuat draft invoice pembelian; mengaitkan GRN bila tersedia. |
| `approve_purchase_document` | `accounting_approver` (≠ `created_by`) | `p_idempotency_key`, `p_purchase_document_id`, `p_expected_version` | Maker-checker; jika terhubung GRN mengubah `goods_receipts.invoiced_status = 'invoiced'` & memancarkan `purchase_invoice_approved` (`clears_grni = true` -> Debit `2106`, Kredit `2101`). |
| `create_supplier_payment` | `accountant`, `accounting_approver`, `finance_maker`, `finance_checker` | `p_idempotency_key`, `p_company_id`, `p_branch_id`, `p_supplier_id`, `p_fund_account_id`, `p_payment_date`, `p_reference_no`, `p_allocations` | Memvalidasi sisa utang per tagihan (`FOR UPDATE`) dan membentuk draft pembayaran pemasok. |
| `approve_supplier_payment` | `accounting_approver`, `finance_checker` (≠ `created_by`) | `p_idempotency_key`, `p_supplier_payment_id`, `p_expected_version` | Maker-checker, menaikkan `paid_amount` dan `payment_status`, memancarkan `supplier_payment_approved`. |
| `recalculate_inventory_valuation` | `accountant`, `accounting_approver` | `p_idempotency_key`, `p_company_id`, `p_branch_id`, `p_product_id`, `p_new_unit_cost`, `p_effective_date`, `p_reason` | Mencatat `inventory_revaluations`, memperbarui `inventory_valuations`, dan mencatat audit trail. |
| `create_expense_document` | `accountant`, `accounting_approver`, `finance_maker` | `p_idempotency_key`, `p_company_id`, `p_branch_id`, `p_expense_mode`, `p_expense_date`, `p_category_coa`, `p_vendor_name`, `p_fund_account_id`, `p_amount`, `p_description`, `p_evidence_path` | Membuat draft dokumen biaya (`direct_paid`, `accrued`, `prepaid`, `accrual_settlement`). |
| `approve_expense_document` | `accounting_approver`, `finance_checker` (≠ `created_by`) | `p_idempotency_key`, `p_expense_document_id`, `p_expected_version` | Maker-checker, menyetujui dokumen biaya dan memancarkan `expense_approved`. |
| `register_fixed_asset` | `accountant`, `accounting_approver` | `p_idempotency_key`, `p_company_id`, `p_branch_id`, `p_name`, `p_acquisition_date`, `p_ready_to_use_date`, `p_cost`, `p_residual_value`, `p_useful_life_months`, `p_location`, `p_fund_account_id` | Mencatat `fixed_assets` dan memposting jurnal perolehan (`1201` vs Kas/Bank, `investing`). |
| `run_depreciation` | `accountant`, `accounting_approver` | `p_idempotency_key`, `p_company_id`, `p_period_code` | Idempoten per aset & periode (`uq_depreciation_asset_period`), menghitung penyusutan garis lurus, membuat jurnal `6201` vs `1202` (`non_cash`) dan menautkan `journal_entry_id`. |
| `create_loan_repayment` | `accountant`, `accounting_approver` | `p_idempotency_key`, `p_loan_id`, `p_payment_date`, `p_principal_paid`, `p_interest_paid`, `p_fund_account_id`, `p_evidence_ref` | Mencatat `loan_repayments`, menurunkan `outstanding_principal`, memposting jurnal pokok (`2201`, `financing`) + bunga (`6401`, `operating`) vs Kas/Bank (`financing`). |
| `create_equity_transaction` | `accountant`, `accounting_approver` | `p_idempotency_key`, `p_company_id`, `p_branch_id`, `p_txn_type`, `p_txn_date`, `p_party_name`, `p_fund_account_id`, `p_amount`, `p_notes` | Mencatat `equity_transactions` (`capital_injection`, `owner_draw`, `dividend`) dan memposting jurnal (`3101`/`3103`, `financing`). |

---

## 3. Saldo Awal, Kebijakan, Rekonsiliasi, Pajak & Pelaporan (`0008`)

| Nama RPC | Peran Diizinkan | Parameter Utama | Efek & Validasi Kritis |
| :--- | :--- | :--- | :--- |
| `submit_opening_balance` | `accountant`, `accounting_approver` | `p_idempotency_key`, `p_company_id`, `p_as_of_date`, `p_lines` | Memaksa Total Debit == Total Kredit tanpa plug otomatis; menyimpan status `submitted`. |
| `approve_opening_balance` | `accounting_approver` (≠ `opening_submitted_by`) | `p_idempotency_key`, `p_company_id` | Maker-checker saldo awal & subledger pembuka -> `approved`. |
| `update_accounting_policy` | `accountant`, `accounting_approver`, `system_admin` (`allow_auto_post_deterministic` khusus `accounting_approver`) | `p_idempotency_key`, `p_company_id`, `p_patch` | Mengubah kebijakan kerangka pelaporan, status pajak, batas materialitas dana tak dikenal, atau auto-post deterministik. |
| `approve_bank_reconciliation` | `accounting_approver`, `finance_checker`, `reconciliation_reviewer` | `p_idempotency_key`, `p_bank_reconciliation_id` | Menyetujui berita acara rekonsiliasi bank dengan validasi saldo buku vs rekening koran. |
| `toggle_tax_code` | `accountant`, `accounting_approver` | `p_idempotency_key`, `p_tax_code_id` | Mengaktifkan/menonaktifkan kode pajak (`is_active`). |
| `create_report_snapshot` | `accountant`, `accounting_approver`, `owner_viewer` | `p_idempotency_key`, `p_company_id`, `p_report_code`, `p_period_code`, `p_as_of_date`, `p_snapshot_status`, `p_payload` | Menyimpan snapshot laporan berversi (`snapshot_version`) secara immutable. |
| `get_financial_report` | Semua anggota perusahaan (`is_company_member`) | `p_company_id`, `p_start_date`, `p_end_date`, `p_branch_id` | Mengembalikan Trial Balance terposting dari `v_app3_trial_balance_posted` dan jumlah event belum terposting. |
