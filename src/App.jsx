import { useCallback, useEffect, useRef, useState } from 'react';
import Home from './components/Home';
import Room from './components/Room';
import Toaster from './components/Toaster';
import { HostEngine } from './lib/hostEngine';
import { ClientEngine } from './lib/clientEngine';
import { normalizeRoom } from './lib/utils';

function setRoomParam(peerId) {
  const url = new URL(location.href);
  if (peerId) url.searchParams.set('room', peerId);
  else url.searchParams.delete('room');
  history.replaceState(null, '', url);
}

export default function App() {
  const [engine, setEngine] = useState(null);
  const [homeError, setHomeError] = useState('');
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

  const retry = useCallback(() => {
    if (engine?.state.role === 'client') return engine.reconnect();
    engine?.destroy();
    setEngine(new HostEngine());
  }, [engine]);

  // 掃描 QR Code 開啟的 ?room=<HostPeerID> 連結：直接加入
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const param = new URLSearchParams(location.search).get('room');
    if (!param) return;
    const peerId = normalizeRoom(param);
    if (peerId) join(peerId);
    else {
      setRoomParam(null);
      setHomeError('配對連結無效，請重新掃描或手動輸入代碼。');
    }
  }, [join]);

  return (
    <>
      {engine ? (
        <Room engine={engine} onLeave={leave} onRetry={retry} />
      ) : (
        <Home onHost={host} onJoin={join} initialError={homeError} />
      )}
      <Toaster />
    </>
  );
}
