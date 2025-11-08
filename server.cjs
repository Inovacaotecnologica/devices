const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.API_PORT || 5175);
const app = express();

function devicesPath() { return path.join(__dirname, 'devices.json'); }

function loadDevices() {
  const p = devicesPath();
  if (!fs.existsSync(p)) { console.error(`[proxy] ERRO: ${p} não encontrado`); process.exit(1); }
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    const json = JSON.parse(raw);
    if (!Array.isArray(json)) throw new Error('JSON raiz deve ser um array');
    return json;
  } catch (e) {
    console.error('[proxy] ERRO ao ler/parsear devices.json:', e.message);
    process.exit(1);
  }
}

let devices = loadDevices();
console.log('[proxy] devices carregados:', devices.map(d => d.id).join(', ') || '(vazio)');

fs.watchFile(devicesPath(), { interval: 1500 }, () => {
  try { devices = loadDevices(); console.log('[proxy] devices.json recarregado:', devices.map(d => d.id).join(', ')); }
  catch (e) { console.error('[proxy] erro no reload do devices.json:', e.message); }
});

app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));
app.get('/api/devices', (_req, res) => res.json(devices.map(d => ({ id: d.id, target: d.target }))));

app.use('/api/devices/:id', (req, res, next) => {
  const id = req.params.id;
  const dev = devices.find(d => d.id === id);
  if (!dev) return res.status(404).json({ error: `device '${id}' não encontrado` });

  const tail = req.url.replace(/^\/+/, '');
  const firstSeg = tail.split('/')[0] || '';
  const mapped = dev.routes?.[firstSeg];
  const rest = tail.slice(firstSeg.length);
  const targetPath = (mapped || `/${tail}`).replace(/\/+$/, '') + rest;

  console.log(`[proxy] ${id} -> ${dev.target}${targetPath}`);

  return createProxyMiddleware({
    target: dev.target,
    changeOrigin: true,
    pathRewrite: () => targetPath,
    onProxyReq: (proxyReq) => proxyReq.setHeader('Cache-Control', 'no-store'),
    onError: (err, _req, res_) => {
      console.error('[proxy] erro ao conectar no target:', err.message);
      res_.status(502).json({ error: 'bad_gateway', detail: err.message });
    }
  })(req, res, next);
});

app.listen(PORT, '127.0.0.1', () => console.log(`[proxy] rodando em http://127.0.0.1:${PORT}`));
