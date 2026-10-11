import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert, FolderDown, Inbox, LoaderCircle, RefreshCw, ServerCog, Trash2, Unplug } from 'lucide-react';
import Header from './Header';
import PairingPanel from './PairingPanel';
import Composer from './Composer';
import ItemCard, { Progress } from './ItemCard';
import DropOverlay from './DropOverlay';
import { useEngine } from '../hooks/useEngine';
import { isEditable } from '../lib/utils';
import { exportZip } from '../lib/exportZip';
import { toast } from '../lib/toast';

/** 剪貼簿截圖通常叫 image.png，改成可辨識的名稱 */
function renamePasted(file) {
  if (file.name && file.name !== 'image.png') return file;
  const ext = (file.type.split('/')[1] || 'bin').replace('jpeg', 'jpg');
  const stamp = new Date().toLocaleString('sv').replace(/[-: ]/g, '').slice(0, 14);
  return new File([file], `貼上的圖片-${stamp}.${ext}`, { type: file.type });
}

function FullState({ icon: Icon, spin, title, children, actions }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm text-center">
        <Icon size={36} className={`mx-auto mb-4 ${spin ? 'animate-spin text-indigo-500' : 'text-rose-500'}`} />
        <h1 className="text-lg font-semibold">{title}</h1>
        {children && <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{children}</p>}
        {actions && <div className="mt-6 flex justify-center gap-2">{actions}</div>}
      </div>
    </main>
  );
}

export default function Room({ engine, onLeave, onRetry }) {
  const s = useEngine(engine);
  const isHost = s.role === 'host';
  const canSend = isHost ? s.status === 'ready' : s.status === 'connected';
  const [draft, setDraft] = useState('');
  const [pairCollapsed, setPairCollapsed] = useState(false);
  const textareaRef = useRef(null);
  const [exporting, setExporting] = useState(null); // { done, total } | null

  const sendFiles = useCallback(
    (files) => {
      if (!canSend) return toast('目前未連線，無法傳送', 'error');
      engine.sendFiles(files);
    },
    [engine, canSend],
  );

  // 全域貼上：檔案 / 截圖直接上傳；在輸入框外貼上的文字放進輸入框
  useEffect(() => {
    const onPaste = (e) => {
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length) {
        e.preventDefault();
        sendFiles(files.map(renamePasted));
        return;
      }
      if (isEditable(e.target)) return;
      const text = e.clipboardData?.getData('text');
      if (!text) return;
      e.preventDefault();
      setDraft((d) => d + text);
      textareaRef.current?.focus();
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [sendFiles]);

  const leave = () => {
    if (isHost && s.status === 'ready' && !confirm('確定解散空間？所有裝置都會中斷連線，暫存的內容也會清除。')) return;
    onLeave();
  };

  const runExport = async () => {
    setExporting({ done: 0, total: 0 });
    try {
      const skipped = await exportZip(engine, (done, total) => setExporting({ done, total }));
      toast(skipped ? `已匯出，但有 ${skipped} 個檔案無法取得` : '已匯出 ZIP', skipped ? 'error' : 'success');
    } catch (err) {
      toast(err.message || '匯出失敗', 'error');
    } finally {
      setExporting(null);
    }
  };

  const clearAll = () => {
    if (confirm('確定清除全部內容？所有裝置上的文字與檔案都會被移除。')) engine.clearAll();
  };

  const itemsDesc = useMemo(() => [...s.items].reverse(), [s.items]);
  const incoming = useMemo(() => {
    const ids = new Set(s.items.map((i) => i.id));
    return Object.entries(s.transfers).filter(([id, t]) => isHost && t.dir === 'down' && !ids.has(id));
  }, [s.transfers, s.items, isHost]);

  // ---- 全頁狀態 ----
  if (isHost && s.status === 'starting') {
    return <FullState icon={LoaderCircle} spin title="正在建立空間…" children="連線至信令伺服器並產生房間代碼" />;
  }
  if (s.status === 'error') {
    return (
      <FullState
        icon={CircleAlert}
        title={isHost ? '無法建立空間' : '無法加入空間'}
        children={s.error}
        actions={
          <>
            <button className="btn btn-secondary" onClick={onLeave}>
              返回首頁
            </button>
            <button className="btn btn-primary" onClick={onRetry}>
              <RefreshCw size={16} /> 重試
            </button>
          </>
        }
      />
    );
  }
  if (!isHost && s.status === 'connecting' && !s.items.length) {
    return (
      <FullState
        icon={LoaderCircle}
        spin
        title={`正在加入空間 ${s.code}…`}
        children="建立點對點連線中，通常只需要幾秒鐘。"
        actions={
          <button className="btn btn-secondary" onClick={onLeave}>
            取消
          </button>
        }
      />
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <Header
        s={s}
        engine={engine}
        onLeave={leave}
        onTogglePair={() => {
          setPairCollapsed((c) => !c);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />

      {isHost && (
        <div className="border-b border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
          <p className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-2 text-xs sm:text-sm">
            <ServerCog size={16} className="shrink-0" />
            此裝置是主控伺服器，請保持分頁開啟。關閉或重新整理將導致共享空間解散。
          </p>
        </div>
      )}

      {!isHost && ['disconnected', 'closed', 'connecting'].includes(s.status) && (
        <div className="border-b border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 text-sm">
            <Unplug size={16} className="shrink-0" />
            <span className="flex-1">
              {s.status === 'closed'
                ? '主控裝置已關閉，共享空間已解散。'
                : s.status === 'connecting'
                  ? '正在重新連線…'
                  : '與主控裝置的連線中斷。'}
            </span>
            {s.status === 'disconnected' && (
              <button className="btn btn-sm btn-primary" onClick={() => engine.reconnect()}>
                <RefreshCw size={14} /> 重新連線
              </button>
            )}
            {s.status === 'closed' && (
              <button className="btn btn-sm btn-secondary" onClick={onLeave}>
                返回首頁
              </button>
            )}
          </div>
        </div>
      )}

      <main className="mx-auto grid w-full max-w-5xl flex-1 items-start gap-4 px-4 py-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6 lg:py-6">
        {isHost && (
          <aside className="lg:sticky lg:top-20 lg:order-last">
            <PairingPanel s={s} collapsed={pairCollapsed} onToggle={() => setPairCollapsed((c) => !c)} />
          </aside>
        )}

        <section className="flex min-w-0 flex-col gap-3">
          <Composer
            draft={draft}
            setDraft={setDraft}
            onSendText={(text) => engine.sendText(text)}
            onSendFiles={sendFiles}
            disabled={!canSend}
            textareaRef={textareaRef}
          />

          {incoming.map(([id, t]) => (
            <div key={id} className="card animate-item-in p-4">
              <div className="truncate text-sm">
                <span className="text-slate-500 dark:text-slate-400">正在接收來自 {t.from} 的檔案：</span>
                <span className="font-medium">{t.name}</span>
              </div>
              <Progress t={t} />
            </div>
          ))}

          {itemsDesc.length > 0 && (
            <div className="flex items-center gap-1 px-1 pt-1">
              <span className="text-sm text-slate-500 dark:text-slate-400">{itemsDesc.length} 個項目</span>
              <button className="btn btn-sm btn-ghost ml-auto" onClick={runExport} disabled={!!exporting}>
                {exporting ? <LoaderCircle size={14} className="animate-spin" /> : <FolderDown size={14} />}
                {exporting ? (exporting.total ? `打包中 ${exporting.done}/${exporting.total}` : '打包中…') : '匯出 ZIP'}
              </button>
              <button className="btn btn-sm btn-ghost hover:!bg-rose-50 hover:text-rose-600 dark:hover:!bg-rose-500/10" onClick={clearAll} disabled={!canSend}>
                <Trash2 size={14} />
                全部清除
              </button>
            </div>
          )}

          {itemsDesc.length ? (
            itemsDesc.map((item) => <ItemCard key={item.id} item={item} s={s} engine={engine} />)
          ) : (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 px-6 py-14 text-center dark:border-slate-700">
              <Inbox size={32} className="mb-3 text-slate-300 dark:text-slate-600" />
              <p className="font-medium text-slate-600 dark:text-slate-300">還沒有任何內容</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">輸入文字，或拖曳、貼上檔案開始分享。</p>
            </div>
          )}
        </section>
      </main>

      <DropOverlay onFiles={sendFiles} />
    </div>
  );
}
