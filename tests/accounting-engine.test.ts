import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyntheticDemoDataset } from '../src/data/syntheticSeed';
import {
  assertOpenPeriod,
  buildLinesForEvent,
  computeFinancialStatements,
  computeGeneralLedger,
  processEventIntoDataset,
} from '../src/lib/accountingEngine';
import { D, addMoney, cmpMoney, roundMoney, subMoney, sumMoney } from '../src/lib/decimal';
import { buildCSVString, sanitizeCsvCell } from '../src/lib/exportUtils';
import { AccountingEvent } from '../src/types/finops';

test('1. Double-entry balance holds for every canonical accounting event recipe', () => {
  const ds = createSyntheticDemoDataset();
  const sampleEvents: AccountingEvent[] = [
    {
      id: 't-ev-trf',
      company_id: ds.companyId,
      branch_id: ds.branches[0].id,
      event_type: 'receipt_transfer_verified',
      source_type: 'receipt',
      source_id: 'r1',
      source_version: 1,
      effective_date: '2026-11-10',
      payload_snapshot: {
        receipt_number: 'RCV-T-1',
        customer_id: 'c-00104',
        customer_gross_amount: '1000000.00',
        bank_net_amount: '993500.00',
        bank_fee_amount: '6500.00',
        bank_fee_bearer: 'company',
        fund_account_id: 'fa-bca',
      },
      mapping_version: 'v1',
      dependency_ids: [],
      processing_status: 'queued',
      error_message: null,
      retry_count: 0,
      created_by: 'u1',
      created_at: '2026-11-10T10:00:00+07:00',
    },
    {
      id: 't-ev-unid',
      company_id: ds.companyId,
      branch_id: ds.branches[0].id,
      event_type: 'receipt_unidentified_verified',
      source_type: 'receipt',
      source_id: 'r2',
      source_version: 1,
      effective_date: '2026-11-10',
      payload_snapshot: { receipt_number: 'RCV-U-1', verified_amount: '250000.00', fund_account_id: 'fa-bca' },
      mapping_version: 'v1',
      dependency_ids: [],
      processing_status: 'queued',
      error_message: null,
      retry_count: 0,
      created_by: 'u1',
      created_at: '2026-11-10T10:00:00+07:00',
    },
    {
      id: 't-ev-res',
      company_id: ds.companyId,
      branch_id: ds.branches[0].id,
      event_type: 'receipt_identity_resolved',
      source_type: 'receipt',
      source_id: 'r2',
      source_version: 2,
      effective_date: '2026-11-11',
      payload_snapshot: { receipt_number: 'RCV-U-1', customer_id: 'c-00104', amount: '250000.00' },
      mapping_version: 'v1',
      dependency_ids: [],
      processing_status: 'queued',
      error_message: null,
      retry_count: 0,
      created_by: 'u1',
      created_at: '2026-11-11T10:00:00+07:00',
    },
    {
      id: 't-ev-dep-bank',
      company_id: ds.companyId,
      branch_id: ds.branches[0].id,
      event_type: 'cash_deposit_direct_bank_accepted',
      source_type: 'cash_deposit',
      source_id: 'd2',
      source_version: 1,
      effective_date: '2026-11-11',
      payload_snapshot: { deposit_number: 'DEP-2', collector_staff_id: 'staff-andi', target_fund_account_id: 'fa-bca', received_amount: '1000000.00' },
      mapping_version: 'v1',
      dependency_ids: [],
      processing_status: 'queued',
      error_message: null,
      retry_count: 0,
      created_by: 'u1',
      created_at: '2026-11-11T10:00:00+07:00',
    },
    {
      id: 't-ev-grni-clear',
      company_id: ds.companyId,
      branch_id: ds.branches[0].id,
      event_type: 'purchase_invoice_approved',
      source_type: 'purchase_document',
      source_id: 'po-grn',
      source_version: 1,
      effective_date: '2026-11-11',
      payload_snapshot: { doc_number: 'PINV-001', supplier_id: 'sup-01', total_amount: '12000000.00', clears_grni: true },
      mapping_version: 'v1',
      dependency_ids: [],
      processing_status: 'queued',
      error_message: null,
      retry_count: 0,
      created_by: 'u1',
      created_at: '2026-11-11T10:00:00+07:00',
    },
    {
      id: 't-ev-sup-pay',
      company_id: ds.companyId,
      branch_id: ds.branches[0].id,
      event_type: 'supplier_payment_approved',
      source_type: 'supplier_payment',
      source_id: 'sp-1',
      source_version: 1,
      effective_date: '2026-11-12',
      payload_snapshot: { payment_number: 'PAY-SUP-001', supplier_id: 'sup-01', amount: '5000000.00', fund_account_id: 'fa-bca' },
      mapping_version: 'v1',
      dependency_ids: [],
      processing_status: 'queued',
      error_message: null,
      retry_count: 0,
      created_by: 'u1',
      created_at: '2026-11-12T10:00:00+07:00',
    },
    {
      id: 't-ev-exp-prepaid',
      company_id: ds.companyId,
      branch_id: ds.branches[0].id,
      event_type: 'expense_approved',
      source_type: 'expense_document',
      source_id: 'exp-pre',
      source_version: 1,
      effective_date: '2026-11-12',
      payload_snapshot: { doc_number: 'EXP-PRE-1', expense_mode: 'prepaid', category_coa: '6101', cash_coa: '1103', fund_account_id: 'fa-bca', amount: '3000000.00' },
      mapping_version: 'v1',
      dependency_ids: [],
      processing_status: 'queued',
      error_message: null,
      retry_count: 0,
      created_by: 'u1',
      created_at: '2026-11-12T10:00:00+07:00',
    },
  ];

  for (const ev of sampleEvents) {
    const built = buildLinesForEvent(ev, ds);
    const totalD = sumMoney(built.lines.map((l) => l.debit));
    const totalC = sumMoney(built.lines.map((l) => l.credit));
    assert.ok(D(totalD).gt(0), `Event ${ev.event_type} total debit must be > 0`);
    assert.equal(cmpMoney(totalD, totalC), 0, `Event ${ev.event_type} debit must equal credit`);
  }

  // GRNI clearing must debit 2106 (not 1105) and credit 2101
  const grniBuilt = buildLinesForEvent(sampleEvents[4], ds);
  assert.equal(grniBuilt.lines[0].coa_code, '2106');
  assert.equal(grniBuilt.lines[1].coa_code, '2101');

  // Prepaid expense must debit 1106
  const prepaidBuilt = buildLinesForEvent(sampleEvents[6], ds);
  assert.equal(prepaidBuilt.lines[0].coa_code, '1106');
});

test('2. Idempotency prevents duplicate journals on repeated processing or duplicate idempotency_key', () => {
  const ds = createSyntheticDemoDataset();
  const initialJournals = ds.journals.length;
  const first = processEventIntoDataset(ds, 'ev-9', 'user-acc-1', 'idem-ev9-001', 'posted');
  assert.equal(first.idempotentHit, false);
  assert.equal(first.dataset.journals.length, initialJournals + 1);

  // Repeat same idempotency_key
  const second = processEventIntoDataset(first.dataset, 'ev-9', 'user-acc-1', 'idem-ev9-001', 'posted');
  assert.equal(second.idempotentHit, true);
  assert.equal(second.journal.id, first.journal.id);
  assert.equal(second.dataset.journals.length, initialJournals + 1);

  // Repeat same event with different idempotency_key -> still guarded by source_event_id
  const third = processEventIntoDataset(first.dataset, 'ev-9', 'user-acc-1', 'idem-ev9-002', 'posted');
  assert.equal(third.idempotentHit, true);
  assert.equal(third.journal.id, first.journal.id);
});

test('3. Stocked sales delivery with missing/zero COGS or insufficient stock is held cleanly (no zero-COGS post)', () => {
  const ds = createSyntheticDemoDataset();
  assert.throws(
    () => processEventIntoDataset(ds, 'ev-8', 'user-acc-1', 'idem-ev8-001', 'posted'),
    /HPP|Stok|ditahan/i
  );
});

test('4. Internal custody/bank transfers and non-cash deposit allocations are excluded from Direct Operating Cash Flow', () => {
  const ds = createSyntheticDemoDataset();
  // Process ev-9 (internal_fund_transfer_approved: 4.000.000 Kas Kantor -> BCA)
  const afterEv9 = processEventIntoDataset(ds, 'ev-9', 'user-acc-1', 'idem-ev9-cf', 'posted').dataset;

  const rep = computeFinancialStatements(afterEv9, {
    startDate: '2026-11-01',
    endDate: '2026-11-16',
    branchId: 'ALL',
    includeDrafts: false,
  });

  // Cash inflows in Nov: 12jt (transfer rcv-1) + 8jt (cash rcv-2) = 20jt
  // Internal transfers (5jt depot Andi->Kas, 4jt Kas->BCA) must NOT inflate operating inflows!
  // Allocation (10jt 2102->1104) is non_cash and must NOT inflate operating inflows!
  assert.equal(rep.cashFlowDirect.operatingLines[0].amount, '20000000.00');
  // Outflows: 1.5jt BBM (exp-1)
  assert.equal(rep.cashFlowDirect.operatingLines[1].amount, '-1500000.00');
  assert.equal(rep.cashFlowDirect.netOperating, '18500000.00');
  // Opening cash = 10jt + 120jt = 130jt; Closing cash = 130jt + 18.5jt = 148.5jt
  assert.equal(rep.cashFlowDirect.openingCash, '130000000.00');
  assert.equal(rep.cashFlowDirect.closingCashComputed, '148500000.00');
  assert.equal(rep.cashFlowDirect.closingCashBalanceSheet, '148500000.00');
  assert.equal(rep.cashFlowDirect.reconcilesWithBalanceSheet, true);
});

test('5. Opening balance AR invoice settlement (provenance: opening) does not double-count revenue', () => {
  const ds = createSyntheticDemoDataset();
  const rep = computeFinancialStatements(ds, {
    startDate: '2026-11-01',
    endDate: '2026-11-16',
    branchId: 'ALL',
    includeDrafts: false,
  });
  // Only INV-202611-0001 (13jt) is November revenue; 10jt allocation to OPN-INV-001 must not increase revenue
  assert.equal(rep.incomeStatement.grossSales, '13000000.00');
  assert.equal(rep.incomeStatement.cogs, '10000000.00');
  assert.equal(rep.incomeStatement.netProfit, '1500000.00'); // 13jt - 10jt - 1.5jt BBM
});

test('6. Balance Sheet equation, Equity Changes, Trial Balance, and Control Account Tie-Outs match identically', () => {
  const ds = createSyntheticDemoDataset();
  // Before failed event ev-8 (2026-11-12), as of 2026-11-10 all posted control accounts tie out cleanly with subledgers
  const repAsOfNov10 = computeFinancialStatements(ds, {
    startDate: '2026-11-01',
    endDate: '2026-11-10',
    branchId: 'ALL',
    includeDrafts: false,
  });

  assert.equal(repAsOfNov10.trialBalanceTotals.isBalanced, true);
  assert.equal(repAsOfNov10.balanceSheet.isBalanced, true);
  assert.equal(repAsOfNov10.balanceSheet.imbalanceDiff, '0.00');
  assert.equal(repAsOfNov10.equityChanges.reconcilesWithBalanceSheet, true);
  for (const t of repAsOfNov10.tieOuts) {
    assert.equal(t.isMatched, true, `Tie-out mismatch on ${t.label}: GL=${t.glBalance}, Subledger=${t.subledgerBalance}`);
  }

  // As of 2026-11-16, failed event ev-8 (INV-202611-0002 Rp 4.500.000) is surfaced in AR tie-out & completeness gaps -> Draft
  const rep = computeFinancialStatements(ds, {
    startDate: '2026-11-01',
    endDate: '2026-11-16',
    branchId: 'ALL',
    includeDrafts: false,
  });
  const arTieOut = rep.tieOuts.find((t) => t.coaCode === '1104');
  assert.ok(arTieOut);
  assert.equal(arTieOut.difference, '-4500000.00');
  assert.equal(arTieOut.isMatched, false);
  for (const t of rep.tieOuts.filter((x) => x.coaCode !== '1104')) {
    assert.equal(t.isMatched, true, `Tie-out mismatch on ${t.label}`);
  }

  // Report must be Draft because ev-8 (failed), ev-9 (waiting), and missing due_date on INV-202611-0002 + unconfigured SAK/tax exist
  assert.equal(rep.reportStatus, 'Draft');
  assert.ok(rep.completenessGaps.length >= 2);
});

test('7. Historical as-of cut-off report isolation excludes transactions after endDate', () => {
  const ds = createSyntheticDemoDataset();
  const repAsOfNov5 = computeFinancialStatements(ds, {
    startDate: '2026-11-01',
    endDate: '2026-11-05',
    branchId: 'ALL',
    includeDrafts: false,
  });

  // As of 05/11: only je-opn (31/10), je-1 (04/11), je-2 (05/11), je-3 (05/11) exist
  // BBM expense on 09/11 (1.5jt) and cash receipt on 06/11 (8jt) must NOT be included
  assert.equal(repAsOfNov5.incomeStatement.totalOperatingExpenses, '0.00');
  assert.equal(repAsOfNov5.incomeStatement.netProfit, '3000000.00'); // 13jt - 10jt
  assert.equal(repAsOfNov5.cashFlowDirect.closingCashBalanceSheet, '142000000.00'); // 130jt + 12jt BCA
  assert.equal(repAsOfNov5.balanceSheet.isBalanced, true);

  // Check General Ledger running balance for 1101 Kas Kantor
  const glKas = computeGeneralLedger(ds, '1101', '2026-11-01', '2026-11-16', 'ALL');
  assert.equal(glKas.openingBalance, '10000000.00');
  assert.equal(glKas.closingBalance, '13500000.00'); // 10jt + 5jt deposit - 1.5jt BBM
});

test('8. Closed fiscal period lock rejects posting into 2026-10', () => {
  const ds = createSyntheticDemoDataset();
  assert.throws(
    () => assertOpenPeriod(ds.fiscalPeriods, '2026-10-15'),
    /terkunci|closed/i
  );
  const openPeriod = assertOpenPeriod(ds.fiscalPeriods, '2026-11-15');
  assert.equal(openPeriod.period_code, '2026-11');
});

test('9. Decimal.js half-up rounding avoids IEEE 754 floating-point drift', () => {
  assert.equal(roundMoney('0.1', 0), '0.00');
  assert.equal(addMoney('0.10', '0.20'), '0.30');
  assert.equal(subMoney('1000000.00', '333333.33'), '666666.67');
  assert.equal(roundMoney(D('100.5'), 0), '101.00');
});

test('10. CSV formula injection neutralization protects text payloads without corrupting pure numbers', () => {
  assert.equal(sanitizeCsvCell('=CMD|"/C calc"!A0'), '"\'=CMD|""/C calc""!A0"');
  assert.equal(sanitizeCsvCell('+SUM(A1:A2)'), '"\'+SUM(A1:A2)"');
  assert.equal(sanitizeCsvCell('-@evil()'), '"\'-@evil()"');
  assert.equal(sanitizeCsvCell('@HYPERLINK("http://x")'), '"\'@HYPERLINK(""http://x"")"');
  // Pure numbers (including negative numeric strings and JS numbers) remain valid numbers
  assert.equal(sanitizeCsvCell(-1500000), '-1500000');
  assert.equal(sanitizeCsvCell('-1500000.00'), '"-1500000.00"');

  const csv = buildCSVString(
    {
      title: 'Laporan Uji',
      companyName: 'PT Test',
      branchScope: 'Semua Cabang',
      dateRangeLabel: '01/11/2026 - 16/11/2026',
      currency: 'IDR',
      reportStatus: 'Draft',
      footnotes: ['Kerangka SAK: Belum ditetapkan'],
    },
    ['Akun', 'Saldo'],
    [
      ['=1+1', -5000],
      ['Kas Kantor', 10000000],
    ],
    '16/11/2026 12:00 WIB'
  );
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"\'=1+1",-5000'));
  assert.ok(csv.includes('"Kas Kantor",10000000'));
});
