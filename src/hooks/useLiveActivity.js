import { useEffect, useRef } from 'react';
import { isNativeApp } from '../native/platform';
import { liveActivity, toLiveState } from '../native/liveActivity';

const UPDATE_INTERVAL = 1000; // 即時動態有更新頻率預算，進度最多每秒推一次

/** 原生 App 中：空間上線時啟動動態島，狀態變化時節流更新，離開時結束。網頁版不做任何事。 */
export function useLiveActivity(s) {
  const native = isNativeApp();
  const startedCode = useRef(null);
  const timer = useRef(null);
  const latest = useRef(s);
  latest.current = s;

  useEffect(() => {
    if (!native) return;
    const online = s.status === 'ready' || s.status === 'connected';
    if (s.status === 'closed') {
      liveActivity.end();
      startedCode.current = null;
      return;
    }
    // 第一次上線，或 Host 恢復時換了新代碼：重新啟動
    if (online && s.code && startedCode.current !== s.code) {
      startedCode.current = s.code;
      liveActivity.start({ roomCode: s.code, role: s.role, ...toLiveState(s) });
      return;
    }
    if (!startedCode.current || timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      liveActivity.update(toLiveState(latest.current));
    }, UPDATE_INTERVAL);
  }, [native, s]);

  useEffect(
    () => () => {
      if (!native) return;
      clearTimeout(timer.current);
      liveActivity.end();
    },
    [native],
  );
}
