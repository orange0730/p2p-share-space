import { useState, useSyncExternalStore } from 'react';
import { Download, Share, SquarePlus, X } from 'lucide-react';
import { getInstallMode, promptInstall, subscribeInstall } from '../lib/install';

export default function InstallButton() {
  const mode = useSyncExternalStore(subscribeInstall, getInstallMode);
  const [showIosHint, setShowIosHint] = useState(false);

  if (mode === 'installed' || mode === 'none') return null;

  if (mode === 'prompt') {
    return (
      <button className="btn btn-ghost w-full" onClick={promptInstall}>
        <Download size={16} />
        安裝到主畫面
      </button>
    );
  }

  // iOS Safari 沒有安裝 API，只能教使用者手動加入
  return showIosHint ? (
    <div className="card relative p-4 text-sm leading-relaxed">
      <button className="icon-btn absolute right-1 top-1 size-8" onClick={() => setShowIosHint(false)} aria-label="關閉">
        <X size={16} />
      </button>
      <p className="mb-1 font-medium">加入主畫面</p>
      <ol className="list-decimal space-y-1 pl-5 text-slate-600 dark:text-slate-300">
        <li>
          用 Safari 開啟本頁，點下方的分享按鈕 <Share size={14} className="inline -translate-y-px" />
        </li>
        <li>
          選擇「加入主畫面」 <SquarePlus size={14} className="inline -translate-y-px" />
        </li>
      </ol>
    </div>
  ) : (
    <button className="btn btn-ghost w-full" onClick={() => setShowIosHint(true)}>
      <Download size={16} />
      加到主畫面
    </button>
  );
}
