import { QRCodeSVG } from 'qrcode.react';
import { ChevronDown, Copy, Share, TriangleAlert, X } from 'lucide-react';
import { copyText, roomLink } from '../lib/utils';
import { isNativeApp } from '../native/platform';
import { toast } from '../lib/toast';

// 原生 App 的網址也是 localhost，但配對連結會改用公開網址，不需要警告
const isLocalhost = !isNativeApp() && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);

export default function PairingPanel({ s, collapsed, onToggle }) {
  const link = roomLink(s.roomId);
  const digits = /^\d{6}$/.test(s.code) ? s.code.split('') : null;

  const copy = async (text, label) => toast((await copyText(text)) ? `已複製${label}` : '複製失敗', 'success');
  const share = async () => {
    try {
      await navigator.share({ title: 'P2P 共享空間', text: `加入我的共享空間（代碼 ${s.code}）`, url: link });
    } catch {
      /* 使用者取消 */
    }
  };

  if (collapsed) {
    return (
      <button onClick={onToggle} className="card flex w-full items-center gap-3 px-4 py-3 text-left">
        <span className="text-sm text-slate-500 dark:text-slate-400">房間代碼</span>
        <span className="font-mono text-lg font-semibold tracking-widest">{s.code}</span>
        <span className="ml-auto flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400">
          顯示 QR Code <ChevronDown size={14} />
        </span>
      </button>
    );
  }

  return (
    <section className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-semibold">邀請裝置加入</h2>
        <button className="icon-btn -mr-2 size-8" onClick={onToggle} aria-label="收合">
          <X size={18} />
        </button>
      </div>
      <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">用相機掃描 QR Code，或在「加入空間」輸入代碼。</p>

      {digits ? (
        <div className="mb-4 grid grid-cols-6 gap-1.5" aria-label={`房間代碼 ${s.code}`}>
          {digits.map((d, i) => (
            <span
              key={i}
              className="grid h-12 place-items-center rounded-lg bg-slate-100 font-mono text-2xl font-semibold text-slate-900 dark:bg-slate-800 dark:text-white"
            >
              {d}
            </span>
          ))}
        </div>
      ) : (
        <p className="mb-4 break-all rounded-lg bg-slate-100 p-3 font-mono text-sm dark:bg-slate-800">{s.code}</p>
      )}

      <div className="mx-auto w-fit rounded-2xl bg-white p-3 ring-1 ring-slate-200 dark:ring-0">
        <QRCodeSVG value={link} size={184} level="M" marginSize={0} />
      </div>

      {isLocalhost && (
        <p className="mt-4 flex gap-2 rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          <TriangleAlert size={16} className="shrink-0" />
          <span>
            目前網址是 localhost，其他裝置掃描後無法開啟。請改用區網 IP（例如 <code>http://192.168.x.x:5173</code>）或部署後的網址開啟本頁。
          </span>
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button className="btn btn-secondary" onClick={() => copy(link, '配對連結')}>
          <Copy size={16} /> 複製連結
        </button>
        {navigator.share ? (
          <button className="btn btn-secondary" onClick={share}>
            <Share size={16} /> 分享
          </button>
        ) : (
          <button className="btn btn-secondary" onClick={() => copy(s.code, '代碼')}>
            <Copy size={16} /> 複製代碼
          </button>
        )}
      </div>
    </section>
  );
}
