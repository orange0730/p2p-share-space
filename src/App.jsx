import { useCallback, useEffect, useRef, useState } from 'react';
import Home from './components/Home';
import Room from './components/Room';
import Toaster from './components/Toaster';
import { HostEngine, readHostSession } from './lib/hostEngine';
import { ClientEngine, readClientRoom } from './lib/clientEngine';
import { takeSharedPayload } from './lib/shareTarget';
import { normalizeRoom } from './lib/utils';
import { toast } from './lib/toast';

function setRoomParam(peerId) {
  const url = new URL(location.href);
  if (peerId) url.searchParams.set('room', peerId);
  else url.searchParams.delete('room');
  history.replaceState(null, '', url);
}

export default function App() {
  const [engine, setEngine] = useState(null);
  const [homeError, setHomeError] = useState('');
  /** 從系統分享選單帶進來、等待送進空間的內容 { files, text } */
  const [pendingShare, setPendingShare] = useState(null);
  const booted = useRef(false);

  const host = useCallback(() => {
    setRoomParam(null); // Host 頁面不能帶 ?room，否則重新整理會變成加入自己
    setEngine(new HostEngine());
  }, []);

  const join = useCallback((peerId) => {
    setRoomParam(peerId); // 重新整理時可自動重新加入
    setEngine(new ClientEngine(peerId));
  }, []);

  const leave = useCallback(() => {
    setEngine((e) => {
      e?.destroy();
      return null;
    });
    setRoomParam(null);
  }, []);

  const retry = useCallback(() => engine?.reconnect(), [engine]);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      const share = await takeSharedPayload().catch(() => null);
      if (share?.error) toast('分享的內容讀取失敗', 'error');
      else if (share && (share.files.length || share.text)) setPendingShare(share);

      // 1. 掃描 QR Code 開啟的 ?room=<HostPeerID> 連結：直接加入
      const param = new URLSearchParams(location.search).get('room');
      if (param) {
        const peerId = normalizeRoom(param);
        if (peerId) return join(peerId);
        setRoomParam(null);
        return setHomeError('配對連結無效，請重新掃描或手動輸入代碼。');
      }
      // 2. Host 重新整理：以同一代碼恢復空間
      const session = readHostSession();
      if (session) return setEngine(new HostEngine(session));
      // 3. 從分享選單回到 App 時，回到原本加入的空間
      const lastRoom = share ? readClientRoom() : null;
      if (lastRoom) join(lastRoom);
    })();
  }, [join]);

  return (
    <>
      {engine ? (
        <Room engine={engine} onLeave={leave} onRetry={retry} pendingShare={pendingShare} onShareDone={() => setPendingShare(null)} />
      ) : (
        <Home onHost={host} onJoin={join} initialError={homeError} pendingShare={pendingShare} onShareDiscard={() => setPendingShare(null)} />
      )}
      <Toaster />
    </>
  );
}
