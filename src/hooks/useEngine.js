import { useSyncExternalStore } from 'react';

export function useEngine(engine) {
  return useSyncExternalStore(engine.subscribe, engine.getSnapshot);
}
