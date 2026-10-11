const listeners = new Set();
let seq = 0;

/** type: 'info' | 'success' | 'error' */
export function toast(message, type = 'info') {
  const t = { id: ++seq, message, type };
  listeners.forEach((fn) => fn(t));
}

export function onToast(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
