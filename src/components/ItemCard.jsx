import { useState } from 'react';
import { Check, Copy, Download, File, FileArchive, FileAudio, FileImage, FileText, FileVideo, LoaderCircle, Trash2 } from 'lucide-react';
import DeviceIcon from './DeviceIcon';
import Linkify from './Linkify';
import { copyText, fileKind, formatBytes, formatTime } from '../lib/utils';
import { toast } from '../lib/toast';

const FILE_ICONS = { image: FileImage, video: FileVideo, audio: FileAudio, archive: FileArchive, doc: FileText, other: File };
const LONG_TEXT = 600;

export function Progress({ t }) {
  const pct = t.total ? Math.min(100, Math.floor((t.loaded / t.total) * 100)) : 100;
  return (
    <div className="mt-3">
      <div className="mb-1 flex justify-between text-xs tabular-nums text-slate-500 dark:text-slate-400">
        <span>
          {t.dir === 'up' ? '上傳中' : '接收中'} {pct}%
        </span>
        <span>
          {formatBytes(t.loaded)} / {formatBytes(t.total)}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-indigo-500 transition-[width] duration-150" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function TextBody({ item }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const long = item.text.length > LONG_TEXT;

  const copy = async () => {
    if (!(await copyText(item.text))) return toast('複製失敗', 'error');
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className={`whitespace-pre-wrap break-words text-[15px] leading-relaxed ${long && !expanded ? 'line-clamp-[10]' : ''}`}>
          <Linkify text={item.text} />
        </p>
        {long && (
          <button className="mt-1 text-xs font-medium text-indigo-600 dark:text-indigo-400" onClick={() => setExpanded((v) => !v)}>
            {expanded ? '收合' : '顯示全部'}
          </button>
        )}
      </div>
      <button
        onClick={copy}
        className={`btn btn-sm shrink-0 ${copied ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' : 'btn-secondary'}`}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
        {copied ? '已複製' : '複製'}
      </button>
    </div>
  );
}

function FileBody({ item, s, engine }) {
  const local = s.files[item.id];
  const transfer = s.transfers[item.id];
  const kind = fileKind(item.mime, item.name);
  const Icon = FILE_ICONS[kind];
  const available = s.role === 'host' || !!local;
  const downloading = transfer?.dir === 'down';

  return (
    <div>
      {local && kind === 'image' && (
        <a href={local.url} target="_blank" rel="noreferrer" className="mb-3 block w-fit overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800">
          <img src={local.url} alt={item.name} className="max-h-80 w-auto max-w-full object-contain" />
        </a>
      )}
      {local && kind === 'video' && <video src={local.url} controls playsInline preload="metadata" className="mb-3 max-h-80 w-full rounded-xl bg-black" />}
      {local && kind === 'audio' && <audio src={local.url} controls className="mb-3 w-full" />}

      <div className="flex items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
          <Icon size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium" title={item.name}>
            {item.name}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">{formatBytes(item.size)}</div>
        </div>
        <button className={`btn btn-sm shrink-0 ${available ? 'btn-secondary' : 'btn-primary'}`} onClick={() => engine.download(item.id)} disabled={downloading}>
          {downloading ? <LoaderCircle size={14} className="animate-spin" /> : <Download size={14} />}
          {available ? '儲存' : '下載'}
        </button>
      </div>

      {transfer && <Progress t={transfer} />}
    </div>
  );
}

export default function ItemCard({ item, s, engine }) {
  const mine = item.from?.id === s.self.id;
  const sender = s.peers.find((p) => p.id === item.from?.id);
  const fromHost = !!sender?.isHost;

  const remove = () => {
    if (item.failed || confirm('刪除後，所有裝置上的這個項目都會被移除。確定刪除？')) engine.deleteItem(item.id);
  };

  return (
    <article className={`card animate-item-in p-4 ${item.failed ? 'border-rose-200 dark:border-rose-900' : ''}`}>
      <div className="mb-2.5 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
        <DeviceIcon kind={item.from?.kind} size={14} className="shrink-0" />
        <span className="truncate font-medium text-slate-700 dark:text-slate-300">{mine ? '我' : (sender?.name ?? item.from?.name)}</span>
        {fromHost && (
          <span className="shrink-0 rounded bg-amber-100 px-1.5 py-px text-[10px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">主控</span>
        )}
        <span className="shrink-0">· {formatTime(item.createdAt)}</span>
        {item.pending && item.type === 'text' && <span className="shrink-0 text-indigo-500">· 傳送中</span>}
        {item.failed && <span className="shrink-0 text-rose-500">· 傳送失敗</span>}
        <button className="icon-btn -my-2 -mr-2 ml-auto size-8 hover:text-rose-600" onClick={remove} aria-label="刪除" title="刪除">
          <Trash2 size={15} />
        </button>
      </div>
      {item.type === 'text' ? <TextBody item={item} /> : <FileBody item={item} s={s} engine={engine} />}
    </article>
  );
}
