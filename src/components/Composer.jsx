import { useRef } from 'react';
import { Paperclip, SendHorizontal } from 'lucide-react';

const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches;

export default function Composer({ draft, setDraft, onSendText, onSendFiles, disabled, textareaRef }) {
  const fileInput = useRef(null);

  const send = () => {
    const text = draft.trim();
    if (!text || disabled) return;
    onSendText(text);
    setDraft('');
  };

  const onKeyDown = (e) => {
    // 中文輸入法選字時的 Enter 不送出；觸控裝置上 Enter 一律換行
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229 || coarsePointer) return;
    e.preventDefault();
    send();
  };

  return (
    <div className="card p-3 focus-within:border-indigo-300 dark:focus-within:border-indigo-700">
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        rows={3}
        placeholder={coarsePointer ? '輸入文字或貼上連結…' : '輸入文字或貼上連結…（Enter 送出，Shift + Enter 換行）'}
        className="block max-h-60 min-h-20 w-full resize-y bg-transparent px-1 py-1 text-base outline-none placeholder:text-slate-400 field-sizing-content"
      />
      <div className="mt-2 flex items-center gap-2">
        <button className="btn btn-secondary" onClick={() => fileInput.current?.click()} disabled={disabled}>
          <Paperclip size={16} />
          檔案
        </button>
        <span className="hidden text-xs text-slate-400 sm:inline">也可以拖曳檔案到視窗，或直接 Ctrl / ⌘ + V 貼上</span>
        <button className="btn btn-primary ml-auto" onClick={send} disabled={disabled || !draft.trim()}>
          <SendHorizontal size={16} />
          送出
        </button>
      </div>
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = [...e.target.files];
          e.target.value = '';
          if (files.length) onSendFiles(files);
        }}
      />
    </div>
  );
}
