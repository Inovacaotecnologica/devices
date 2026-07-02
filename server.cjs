// server.cjs — Proxy + CORS + /health + persistência por usuário + proxy de devices + TELEMETRIA
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const fs = require('fs');
const path = require('path');
const mqtt = require('mqtt');

const PORT = Number(process.env.PORT || process.env.API_PORT || 5175);
const app = express();

app.use(express.json({ limit: '2mb' }));

// ======================================================
// CORS
// ======================================================
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ======================================================
// HEALTH CHECK
// ======================================================
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ======================================================
// Carregar mapa de devices para proxy
// ======================================================
const devicesPath = path.join(__dirname, 'devices.json');
function loadDevices() {
  try { return JSON.parse(fs.readFileSync(devicesPath, 'utf-8')); }
  catch { return []; }
}
let devices = loadDevices();

if (fs.existsSync(devicesPath)) {
  fs.watchFile(devicesPath, () => {
    try {
      devices = loadDevices();
      console.log('[proxy] devices.json recarregado');
    } catch (e) {
      console.error('[proxy] erro recarregando devices.json', e);
    }
  });
}

// ======================================================
// Persistência por usuário
// ======================================================
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function safeUserFile(email) {
  const safe = String(email || '').toLowerCase().replace(/[^a-z0-9_.@-]/gi, '_');
  return path.join(DATA_DIR, `${safe}.json`);
}
function defaultState() { return { companies: [], devices: [] }; }
function readUserState(email) {
  const fp = safeUserFile(email);
  if (!fs.existsSync(fp)) return defaultState();
  try {
    const raw = fs.readFileSync(fp, 'utf-8');
    const json = JSON.parse(raw);
    return { companies: json.companies || [], devices: json.devices || [] };
  } catch { return defaultState(); }
}
function writeUserState(email, state) {
  const fp = safeUserFile(email);
  fs.writeFileSync(
    fp,
    JSON.stringify({
      companies: Array.isArray(state.companies) ? state.companies : [],
      devices: Array.isArray(state.devices) ? state.devices : [],
    }, null, 2),
    'utf-8'
  );
}

app.get('/api/state/:email?', (req, res) => {
  const email = req.params.email || req.query.user;
  if (!email) return res.status(400).json({ error: 'missing user' });
  return res.json(readUserState(email));
});

app.put('/api/state/:email?', (req, res) => {
  const email = req.params.email || req.body.user;
  if (!email) return res.status(400).json({ error: 'missing user' });
  try {
    writeUserState(email, { companies: req.body.companies, devices: req.body.devices });
    return res.json({ ok: true });
  } catch (e) {
    console.error('[state][write]', e);
    return res.status(500).json({ ok: false });
  }
});

// ======================================================
// Diagnóstico rápido
// ======================================================
app.get('/api/devices', (_req, res) => {
  res.json(devices.map(d => ({ id: d.id, target: d.target })));
});

// ======================================================
// TELEMETRIA UNIVERSAL (NOVO)
// ======================================================
const TELEMETRY_FILE = path.join(__dirname, 'telemetry.json');
let lastTelemetry = {};

// ======================================================
// SSE - ENVIO EM TEMPO REAL PARA O FRONTEND
// ======================================================
const sseClients = new Set();

function sendSseEvent(type, data) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');

  res.write(': connected\n\n');

  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

function loadTelemetry() {
  try {
    if (fs.existsSync(TELEMETRY_FILE)) {
      lastTelemetry = JSON.parse(fs.readFileSync(TELEMETRY_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('[telemetry] erro ao carregar', e);
    lastTelemetry = {};
  }
}
function saveTelemetry() {
  try {
    fs.writeFileSync(TELEMETRY_FILE, JSON.stringify(lastTelemetry, null, 2));
  } catch (e) {
    console.error('[telemetry] erro ao salvar', e);
  }
}

loadTelemetry();
// ======================================================
// MQTT - RECEBIMENTO DE TELEMETRIA
// ======================================================

const MQTT_URL = process.env.MQTT_URL || 'mqtts://61a2835a1bf84052b9c2b861a7e33fc9.s1.eu.hivemq.cloud:8883';
const MQTT_TOPIC = process.env.MQTT_TOPIC || 'devices/#';

const mqttClient = mqtt.connect(MQTT_URL, {
  username: process.env.MQTT_USER || 'devices',
  password: process.env.MQTT_PASS || '',
  protocolVersion: 5,
  reconnectPeriod: 5000,
  connectTimeout: 10000,
});

mqttClient.on('connect', () => {
  console.log(`[mqtt] conectado em ${MQTT_URL}`);
  mqttClient.subscribe(MQTT_TOPIC, (err) => {
    if (err) {
      console.error('[mqtt] erro ao assinar tópico', err.message);
    } else {
      console.log(`[mqtt] assinando ${MQTT_TOPIC}`);
    }
  });
});

mqttClient.on('message', (topic, message) => {
  try {
    const text = message.toString();
    const body = JSON.parse(text);

    const deviceId =
      body.device_id ||
      topic.replace(/^devices\//, '').replace(/\/telemetry$/, '');

    if (!deviceId) return;

    lastTelemetry[deviceId] = {
      ...body,
      device_id: deviceId,
      mqtt_topic: topic,
      received_at: Date.now()
    };

    saveTelemetry();

    sendSseEvent('telemetry', lastTelemetry[deviceId]);

    console.log(`[mqtt][telemetry] ${deviceId}`, lastTelemetry[deviceId]);
  } catch (e) {
    console.error('[mqtt] mensagem inválida', topic, message.toString());
  }
});

mqttClient.on('error', (err) => {
  console.error('[mqtt] erro', err.message);
});

// === POST /api/nivel  (dispositivos enviam dados) ===
app.post('/api/nivel', (req, res) => {
  const body = req.body || {};
  const deviceId = body.device_id;

  if (!deviceId) {
    return res.status(400).json({ ok: false, error: 'missing device_id' });
  }

  lastTelemetry[deviceId] = {
    ...body,
    received_at: Date.now()
  };

  saveTelemetry();

  console.log(`[telemetry] ${deviceId}`, body);

  return res.json({ ok: true });
});

// === GET /api/nivel/:deviceId (dashboard lê último dado) ===
app.get('/api/nivel/:deviceId', (req, res) => {
  const deviceId = req.params.deviceId;
  const data = lastTelemetry[deviceId];
  if (!data) return res.status(404).json({ ok: false, error: 'not found' });
  return res.json(data);
});

// ======================================================
// Proxy para dispositivos reais
// ======================================================
app.use('/api/devices/:id', (req, res, next) => {
  const id = req.params.id;
  const dev = devices.find(d => d.id === id);
  if (!dev) return res.status(404).json({ error: `device '${id}' não encontrado` });

  const tail = req.url.replace(/^\/+/, '');
  const firstSeg = tail.split('/')[0] || '';
  const mapped = (dev.routes && dev.routes[firstSeg]) || `/${tail}`;
  const rest = tail.slice(firstSeg.length);
  const targetPath = (mapped || `/${tail}`).replace(/\/+$/, '') + rest;

  return createProxyMiddleware({
    target: dev.target,
    changeOrigin: true,
    pathRewrite: () => targetPath,
    onProxyReq: (proxyReq) => proxyReq.setHeader('Cache-Control', 'no-store'),
  })(req, res, next);
});

// ======================================================
// START SERVER
// ======================================================
app.listen(PORT, '127.0.0.1', () =>
  console.log(`[API] rodando em http://127.0.0.1:${PORT}`)
);
