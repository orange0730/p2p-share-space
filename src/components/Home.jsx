import { useState } from 'react';
import DeviceNameEditor from './DeviceNameEditor';
import InstallButton from './InstallButton';
import { ArrowLeft, ArrowRight, LogIn, Network, QrCode, Server, ShieldCheck, Zap } from 'lucide-react';
import { getIdentity, normalizeRoom, setDeviceName } from '../lib/utils';

export default function Home({ onHost, onJoin, initialError }) {
  const [joining, setJoining] = useState(!!initialError);
  const [value, setValue] = useState('');
  const [error, setError] = useState(initialError);
  const [name, setName] = useState(() => getIdentity().name);

  const submit = (v = value) => {
    const peerId = normalizeRoom(v);
    if (!peerId) return setError('請輸入 6 位數代碼，或貼上配對連結。');
    onJoin(peerId);
  };

  const onChange = (e) => {
    const v = e.target.value;
    setError('');
    if (/^\d*$/.test(v)) {
      const digits = v.slice(0, 6);
      setValue(digits);
      if (digits.length === 6) submit(digits);
    } else {
      setValue(v); // 允許貼上完整配對連結
    }
  };

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(99,102,241,.18),transparent)]"
      />

      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/25">
            <Network size={28} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">跨裝置共享空間</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
            免登入、免後端。開空間的裝置就是伺服器，
            <br className="hidden sm:block" />
            文字與檔案透過 WebRTC 點對點直傳。
          </p>
        </div>

        {!joining ? (
          <div className="grid gap-3">
            <button onClick={onHost} className="card group flex items-center gap-4 p-5 text-left transition hover:border-indigo-300 hover:shadow-md active:scale-[.99] dark:hover:border-indigo-700">
              <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
                <Server size={24} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">建立空間</span>
                <span className="block text-sm text-slate-500 dark:text-slate-400">成為主控伺服器，產生代碼與 QR Code</span>
              </span>
              <ArrowRight size={18} className="text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-indigo-500" />
            </button>

            <button onClick={() => setJoining(true)} className="card group flex items-center gap-4 p-5 text-left transition hover:border-indigo-300 hover:shadow-md active:scale-[.99] dark:hover:border-indigo-700">
              <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
                <LogIn size={24} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">加入空間</span>
                <span className="block text-sm text-slate-500 dark:text-slate-400">輸入 6 位數代碼，或掃描 QR Code</span>
              </span>
              <ArrowRight size={18} className="text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-indigo-500" />
            </button>
          </div>
        ) : (
          <form
            className="card p-5"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="mb-4 flex items-center gap-2">
              <button
                type="button"
                className="icon-btn -ml-2"
                aria-label="返回"
                onClick={() => {
                  setJoining(false);
                  setError('');
                }}
              >
                <ArrowLeft size={20} />
              </button>
              <h2 className="font-semibold">加入空間</h2>
            </div>
            <label htmlFor="room-code" className="mb-2 block text-sm text-slate-500 dark:text-slate-400">
              房間代碼
            </label>
            <input
              id="room-code"
              autoFocus
              value={value}
              onChange={onChange}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              aria-invalid={!!error}
              className="input h-14 text-center font-mono text-2xl tracking-[0.5em] placeholder:tracking-[0.5em]"
            />
            {error && <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
            <button type="submit" className="btn btn-primary mt-4 w-full" disabled={!value}>
              連線
              <ArrowRight size={16} />
            </button>
            <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              <QrCode size={14} className="mt-0.5 shrink-0" />
              用手機相機掃描主控裝置上的 QR Code，會直接開啟並自動加入，不需輸入代碼。
            </p>
          </form>
        )}

        <div className="mt-4 flex items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <span className="shrink-0">裝置名稱</span>
          <DeviceNameEditor
            name={name}
            onSave={(n) => setName(setDeviceName(n).name)}
            className="max-w-60 font-medium text-slate-700 dark:text-slate-200"
          />
        </div>

        <div className="mx-auto mt-2 max-w-60">
          <InstallButton />
        </div>

        <ul className="mt-6 grid grid-cols-3 gap-2 text-center text-xs text-slate-500 dark:text-slate-400">
          <li className="flex flex-col items-center gap-1.5">
            <Zap size={16} className="text-indigo-500" />
            點對點直傳
          </li>
          <li className="flex flex-col items-center gap-1.5">
            <ShieldCheck size={16} className="text-indigo-500" />
            不經雲端儲存
          </li>
          <li className="flex flex-col items-center gap-1.5">
            <Server size={16} className="text-indigo-500" />
            關閉即解散
          </li>
        </ul>
      </div>
    </main>
  );
}
