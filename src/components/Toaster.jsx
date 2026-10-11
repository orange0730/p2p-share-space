import { useEffect, useState } from 'react';
import { CircleAlert, CircleCheck, Info } from 'lucide-react';
import { onToast } from '../lib/toast';

const ICONS = { info: Info, success: CircleCheck, error: CircleAlert };
const TONES = {
  info: 'text-slate-400',
  success: 'text-emerald-400',
  error: 'text-rose-400',
};

export default function Toaster() {
  const [toasts, setToasts] = useState([]);

  useEffect(
    () =>
      onToast((t) => {
        setToasts((list) => [...list.slice(-2), t]);
        setTimeout(() => setToasts((list) => list.filter((x) => x.id !== t.id)), t.type === 'error' ? 4000 : 2400);
      }),
    [],
  );

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      {toasts.map((t) => {
        const Icon = ICONS[t.type];
        return (
          <div
            key={t.id}
            className="animate-item-in flex max-w-sm items-center gap-2 rounded-xl bg-slate-900/95 px-4 py-2.5 text-sm text-white shadow-lg dark:bg-slate-800"
          >
            <Icon size={16} className={`shrink-0 ${TONES[t.type]}`} />
            <span>{t.message}</span>
          </div>
        );
      })}
    </div>
  );
}
