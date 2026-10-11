import { useEffect, useRef, useState } from 'react';
import { Crown, LogOut, Network, QrCode } from 'lucide-react';
import DeviceIcon from './DeviceIcon';
import DeviceNameEditor from './DeviceNameEditor';
import { copyText, roomLink } from '../lib/utils';
import { toast } from '../lib/toast';

function statusOf(s) {
  if (s.role === 'host') {
    if (s.status !== 'ready') return { tone: 'warn', label: '建立中' };
    if (s.signal === 'offline') return { tone: 'warn', label: '信令重連中' };
    return { tone: 'ok', label: '主控中' };
  }
  switch (s.status) {
    case 'connected':
      return { tone: 'ok', label: '已連線' };
    case 'connecting':
      return { tone: 'warn', label: '連線中' };
    case 'closed':
      return { tone: 'bad', label: '已解散' };
    default:
      return { tone: 'bad', label: '已斷線' };
  }
}

const DOT = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500 animate-pulse',
  bad: 'bg-rose-500',
};

function DevicesMenu({ s, engine }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const st = statusOf(s);
  const online = s.status === 'ready' || s.status === 'connected';

  useEffect(() => {
    if (!open) return;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
      >
        <span className={`size-2 rounded-full ${DOT[st.tone]}`} />
        <span className="font-medium tabular-nums">{online ? s.peers.length : '–'}</span>
        <span className="text-slate-500 dark:text-slate-400">
          台裝置<span className="hidden sm:inline"> · {st.label}</span>
        </span>
      </button>

      {open && (
        <div className="card animate-item-in absolute right-0 top-12 z-40 w-72 max-w-[calc(100vw-2rem)] p-2 shadow-lg">
          <div className="px-2 pb-2 pt-1 text-xs text-slate-500 dark:text-slate-400">
            狀態：{st.label}
            {s.role === 'host' && s.signal === 'offline' && <span className="block">已連線裝置不受影響，新裝置暫時無法加入。</span>}
          </div>
          {online && (
            <ul className="max-h-72 overflow-auto">
              {s.peers.map((p) => (
                <li key={p.id} className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm">
                  <DeviceIcon kind={p.kind} size={16} className="shrink-0 text-slate-400" />
                  {p.id === s.self.id ? (
                    <>
                      <DeviceNameEditor name={p.name} onSave={(n) => engine.rename(n)} className="flex-1" />
                      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800">你</span>
                    </>
                  ) : (
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  )}
                  {p.isHost && <Crown size={14} className="shrink-0 text-amber-500" aria-label="主控裝置" />}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function Header({ s, engine, onLeave, onTogglePair }) {
  const isHost = s.role === 'host';
  const shortCode = s.code.length > 10 ? `${s.code.slice(0, 8)}…` : s.code;

  const copyLink = async () => {
    if (!s.roomId) return;
    toast((await copyText(roomLink(s.roomId))) ? '已複製配對連結' : '複製失敗', 'success');
  };

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/85 pt-[env(safe-area-inset-top)] backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/85">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-indigo-600 text-white">
          <Network size={18} />
        </span>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-semibold">{isHost ? '我的共享空間' : '共享空間'}</div>
          {shortCode && (
            <button onClick={copyLink} title="複製配對連結" className="font-mono text-xs text-slate-500 hover:text-indigo-600 dark:text-slate-400">
              #{shortCode}
            </button>
          )}
        </div>

        <div className="flex-1" />

        <DevicesMenu s={s} engine={engine} />
        {isHost && (
          <button className="icon-btn" onClick={onTogglePair} aria-label="顯示配對 QR Code" title="配對 QR Code">
            <QrCode size={20} />
          </button>
        )}
        <button className="icon-btn hover:text-rose-600" onClick={onLeave} aria-label={isHost ? '解散空間' : '離開空間'} title={isHost ? '解散空間' : '離開空間'}>
          <LogOut size={20} />
        </button>
      </div>
    </header>
  );
}
