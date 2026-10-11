import { downloadZip } from 'client-zip';
import { saveBlob } from './utils';

/** 同名檔案加上 (2)、(3)… 避免在壓縮檔裡互相覆蓋 */
function uniqueName(name, used) {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})${ext}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

const stamp = (ts) => new Date(ts).toLocaleString('sv').slice(0, 19);

/**
 * 把空間內所有內容打包成 ZIP：檔案逐一取得（Client 會依序向 Host 下載），文字合併成一個 txt。
 * onProgress(done, total) 以「檔案數」回報。回傳略過（取得失敗）的檔案數。
 */
export async function exportZip(engine, onProgress) {
  const { items, code, peers } = engine.state;
  const files = items.filter((i) => i.type === 'file' && !i.failed);
  const texts = items.filter((i) => i.type === 'text' && !i.failed);
  const nameOf = (item) => peers.find((p) => p.id === item.from?.id)?.name ?? item.from?.name ?? '';

  const used = new Set();
  const entries = [];
  let skipped = 0;

  if (texts.length) {
    const body = texts.map((t) => `[${stamp(t.createdAt)}] ${nameOf(t)}\n${t.text}`).join('\n\n----------\n\n');
    entries.push({ name: uniqueName('文字訊息.txt', used), lastModified: new Date(), input: `﻿${body}\n` });
  }

  onProgress?.(0, files.length);
  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    try {
      const blob = await engine.fetchBlob(item.id);
      if (blob) entries.push({ name: uniqueName(item.name, used), lastModified: new Date(item.createdAt), input: blob });
      else skipped++;
    } catch {
      skipped++;
    }
    onProgress?.(i + 1, files.length);
  }

  if (!entries.length) throw new Error('沒有可匯出的內容');
  const zip = await downloadZip(entries).blob();
  const date = new Date().toLocaleDateString('sv').replaceAll('-', '');
  saveBlob(zip, `共享空間-${code}-${date}.zip`);
  return skipped;
}
