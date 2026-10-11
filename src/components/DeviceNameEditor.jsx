import { useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { MAX_NAME, deviceName } from '../lib/utils';

/** 行內編輯裝置名稱；留空儲存會恢復預設名稱（作業系統 · 瀏覽器） */
export default function DeviceNameEditor({ name, onSave, className = '' }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);

  const start = () => {
    setValue(name);
    setEditing(true);
  };
  const save = () => {
    onSave(value);
    setEditing(false);
  };

  if (!editing) {
    return (
      <button onClick={start} className={`group flex min-w-0 items-center gap-1.5 text-left ${className}`} title="變更裝置名稱">
        <span className="truncate">{name}</span>
        <Pencil size={13} className="shrink-0 text-slate-400 group-hover:text-indigo-500" />
      </button>
    );
  }

  return (
    <form
      className={`flex min-w-0 items-center gap-1 ${className}`}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <input
        autoFocus
        value={value}
        maxLength={MAX_NAME}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
        placeholder={deviceName()}
        aria-label="裝置名稱"
        className="input h-9 min-w-0 flex-1 px-2.5 text-sm"
      />
      <button type="submit" className="icon-btn size-9 text-emerald-600" aria-label="儲存名稱">
        <Check size={16} />
      </button>
      <button type="button" className="icon-btn size-9" onClick={() => setEditing(false)} aria-label="取消">
        <X size={16} />
      </button>
    </form>
  );
}
