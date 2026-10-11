import { useEffect, useRef, useState } from 'react';

const BASE_TITLE = document.title;
const isAway = () => document.hidden || !document.hasFocus();

/**
 * 不在前景時，其他裝置新增的項目會累計成未讀數：
 * 分頁標題顯示「(3) P2P 共享空間」，已安裝的 PWA 也會在 App 圖示上顯示數字徽章。
 * connected 由 false 變 true 的那一次是（重新）連線時的歷史同步，不算未讀。
 */
export function useUnreadBadge(items, selfId, connected) {
  const [unread, setUnread] = useState(0);
  const seen = useRef(new Set());
  const wasConnected = useRef(false);

  useEffect(() => {
    const fresh = items.filter((i) => !seen.current.has(i.id));
    fresh.forEach((i) => seen.current.add(i.id));
    const fromOthers = fresh.filter((i) => i.from?.id !== selfId).length;
    if (connected && wasConnected.current && fromOthers && isAway()) setUnread((n) => n + fromOthers);
    wasConnected.current = connected;
  }, [items, selfId, connected]);

  useEffect(() => {
    const back = () => !isAway() && setUnread(0);
    document.addEventListener('visibilitychange', back);
    window.addEventListener('focus', back);
    return () => {
      document.removeEventListener('visibilitychange', back);
      window.removeEventListener('focus', back);
    };
  }, []);

  useEffect(() => {
    document.title = unread ? `(${unread > 99 ? '99+' : unread}) ${BASE_TITLE}` : BASE_TITLE;
    if (unread) navigator.setAppBadge?.(unread).catch(() => {});
    else navigator.clearAppBadge?.().catch(() => {});
  }, [unread]);

  useEffect(
    () => () => {
      document.title = BASE_TITLE;
      navigator.clearAppBadge?.().catch(() => {});
    },
    [],
  );
}
