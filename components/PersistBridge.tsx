// scr/components/PersistBridge.tsx
import { useEffect } from 'react';
import { useDevicesStore } from '../useDevicesStore';

export default function PersistBridge() {
  const devices = useDevicesStore((s) => s.devices);
  const loadState = useDevicesStore((s) => s.loadState);
  const saveState = useDevicesStore((s) => s.saveState);

  // Carrega ao iniciar o app (se tiver e-mail no localStorage)
  useEffect(() => {
    const email = localStorage.getItem('userEmail');
    if (email) loadState(email);
  }, [loadState]);

  // Salva sempre que devices mudar (debounce já está no store)
  useEffect(() => {
    const email = localStorage.getItem('userEmail');
    if (email) saveState(email);
  }, [devices, saveState]);

  return null;
}
