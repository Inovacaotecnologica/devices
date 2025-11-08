// services/devices.ts
export type NivelPayload = {
  device_id?: string;
  nivel_pct?: number;
  sim_nivel_pct?: number;
  wifi_rssi?: number;
  ts?: number;        // pode ser uptime, então não confie
  ts_epoch?: number;  // se um dia vier epoch real, usamos
};

export async function fetchDeviceJson(deviceId: string, route: string) {
  const r = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/${route}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`[${deviceId}] HTTP ${r.status}`);
  return r.json();
}

/** Regra de "online": sucesso no fetch + idade < 30s OU RSSI válido (<0) */
export function computeOnline(d: Partial<NivelPayload>, lastOkAt: number) {
  const now = Date.now();
  const epoch = typeof d.ts_epoch === 'number' ? d.ts_epoch : now; // se não vier, usa agora
  const age = now - Math.min(epoch, now);
  const byAge = (now - lastOkAt) < 30_000 && age < 120_000;
  const byRssi = typeof d.wifi_rssi === 'number' && d.wifi_rssi < 0;
  return byAge || byRssi;
}

/** Extrai o valor para o widget (prioriza real, cai para simulado) */
export function extractNivel(d: Partial<NivelPayload>) {
  if (typeof d.nivel_pct === 'number') return d.nivel_pct;
  if (typeof d.sim_nivel_pct === 'number') return d.sim_nivel_pct;
  return null;
}
