import React, { useState } from 'react';
import { ShieldAlert, Database, LogIn, Play, CheckCircle2, AlertCircle } from 'lucide-react';
import { getEnvDiagnostics, isSupabaseConfigured, supabase } from '../lib/supabase';

interface SetupAndAuthViewProps {
  onEnterDemoMode: () => void;
  onAuthSuccess: () => void;
  authError?: string | null;
}

export const SetupAndAuthView: React.FC<SetupAndAuthViewProps> = ({
  onEnterDemoMode,
  onAuthSuccess,
  authError,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(authError ?? null);
  const envDiag = getEnvDiagnostics();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setLoading(true);
    setError(null);
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (signInErr) {
      setError(`Gagal masuk: ${signInErr.message}`);
      return;
    }
    onAuthSuccess();
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center px-6 py-12">
      <div className="mx-auto w-full max-w-4xl grid grid-cols-1 gap-8 lg:grid-cols-12 items-start">
        <div className="lg:col-span-7 space-y-6">
          <div>
            <p className="text-xs font-medium text-teal-700">FINOPS_SHARED_V1 · Modul Akuntansi (App 3)</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Akuntansi & Laporan</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Sistem pembukuan internal berbasis akrual, double-entry ledger immutable, HPP moving weighted average,
              rekonsiliasi subledger, dan laporan keuangan terintegrasi dengan App 1 (Penerimaan & Setoran) serta App 2 (Penjualan & Rekonsiliasi).
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Database className="h-4 w-4 text-slate-700" />
              <span>Status Koneksi Backend Bersama (Supabase)</span>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-600">VITE_SUPABASE_URL</span>
                <span className="inline-flex items-center gap-1.5 font-mono text-slate-800">
                  {envDiag.hasUrl ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      <span>{envDiag.urlPreview}</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
                      <span className="text-amber-700">Belum dikonfigurasi</span>
                    </>
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-600">VITE_SUPABASE_PUBLISHABLE_KEY</span>
                <span className="inline-flex items-center gap-1.5 font-mono text-slate-800">
                  {envDiag.hasKey ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      <span>Terpasang</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
                      <span className="text-amber-700">Belum dikonfigurasi</span>
                    </>
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5">
                <span className="text-slate-600">Migrasi Database Tambahan App 3</span>
                <span className="font-mono text-slate-700">0005, 0006, 0007 (Additive-only)</span>
              </div>
            </div>

            {!isSupabaseConfigured && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900 space-y-1.5">
                <div className="font-semibold flex items-center gap-1.5">
                  <ShieldAlert className="h-4 w-4 text-amber-700" />
                  <span>Halaman Setup Administrator — Environment Produksi Belum Terpasang</span>
                </div>
                <p className="leading-relaxed">
                  Untuk menghubungkan ke proyek Supabase bersama App 1 & App 2, isi <code className="font-mono">VITE_SUPABASE_URL</code> dan{' '}
                  <code className="font-mono">VITE_SUPABASE_PUBLISHABLE_KEY</code> pada environment proyek lalu jalankan migrasi{' '}
                  <code className="font-mono">0005–0007</code> sekali pada SQL Editor Supabase. Pengguna biasa harap menghubungi administrator sistem.
                </p>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
            <div className="text-sm font-semibold text-slate-900">Mode Uji Terpisah (Data Sintetis)</div>
            <p className="text-xs leading-relaxed text-slate-600">
              Untuk meninjau alur pembukuan, mesin event, perhitungan moving weighted average HPP, rekonsiliasi GL-subledger,
              tutup buku, dan ekspor laporan tanpa mengakses database produksi, gunakan mode demo sintetis terpisah.
            </p>
            <button
              type="button"
              onClick={onEnterDemoMode}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <Play className="h-3.5 w-3.5" />
              Buka Mode Demo (Data Sintetis Terpisah)
            </button>
          </div>
        </div>

        <div className="lg:col-span-5 rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="text-base font-semibold text-slate-900">Masuk Pengguna Terotorisasi</h2>
          <p className="mt-1 text-xs text-slate-600">
            Role dan akses cabang ditetapkan di backend bersama (`memberships`). Tidak ada pemilihan role dari browser.
          </p>

          {error && (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Email Akun</label>
              <input
                type="email"
                required
                disabled={!isSupabaseConfigured}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="akuntan@perusahaan.co.id"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Kata Sandi</label>
              <input
                type="password"
                required
                disabled={!isSupabaseConfigured}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-400"
              />
            </div>
            <button
              type="submit"
              disabled={!isSupabaseConfigured || loading}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <LogIn className="h-4 w-4" />
              {loading ? 'Memverifikasi Sesi...' : 'Masuk dengan Supabase Auth'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
