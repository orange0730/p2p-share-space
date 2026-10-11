import { useEffect, useRef, useState } from 'react';
import { CloudUpload } from 'lucide-react';

const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');

/** 全視窗拖曳上傳 */
export default function DropOverlay({ onFiles }) {
  const [active, setActive] = useState(false);
  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;

  useEffect(() => {
    let depth = 0;
    const enter = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setActive(true);
    };
    const over = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    };
    const leave = (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setActive(false);
    };
    const drop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setActive(false);
      // 拖進資料夾時會得到 size 0、type 空白的項目，略過
      const files = [...e.dataTransfer.files].filter((f) => f.size > 0 || f.type);
      if (files.length) onFilesRef.current(files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  if (!active) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-indigo-600/10 p-6 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-indigo-500 bg-white/90 px-12 py-10 text-indigo-600 shadow-xl dark:bg-slate-900/90 dark:text-indigo-400">
        <CloudUpload size={40} />
        <span className="text-lg font-semibold">放開以分享檔案</span>
      </div>
    </div>
  );
}
