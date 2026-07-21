import React, {
  useState,
  useEffect,
  useCallback,
  createContext,
  useContext,
  useMemo,
  ReactNode,
} from 'react';
import { Language, User, Company, Device, Widget, Protocol, WidgetType } from './types';
import { translations, OFFLINE_THRESHOLD } from './constants';
import { fetchUsers } from './services/googleSheetService';
import {
  PlusIcon,
  BuildingOfficeIcon,
  WifiIcon,
  NoWifiIcon,
  TrashIcon,
  ChevronDownIcon,
  GlobeAltIcon,
  CodeBracketIcon,
} from './icons';

// =================================================================================
// TIPAGEM LOCAL ESTENDIDA (THRESHOLDS POR WIDGET + FÓRMULA ENGENHARIA)
// =================================================================================

type ExtendedWidget = Widget & {
  minAcceptable?: number | null;
  maxAcceptable?: number | null;
  /** Fórmula de engenharia, exemplo: x * 0.25 + 10 */
  engFormula?: string | null;
};

interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}
const I18nContext = createContext<I18nContextType | null>(null);
const useI18n = () => useContext(I18nContext)!;

interface AuthContextType {
  user: User | null;
  login: (email: string, pass: string) => Promise<boolean>;
  logout: () => void;
}
const AuthContext = createContext<AuthContextType | null>(null);
const useAuth = () => useContext(AuthContext)!;

interface DataContextType {
  companies: Company[];
  devices: Device[];
  addCompany: (name: string) => void;
  deleteCompany: (companyId: string) => void;
  addDevice: (
    device: Omit<Device, 'id' | 'lastData' | 'lastUpdated' | 'isOnline'>,
  ) => void;
  deleteDevice: (deviceId: string) => void;
}
const DataContext = createContext<DataContextType | null>(null);
const useData = () => useContext(DataContext)!;

// Alertas centralizados
interface AlertsContextType {
  triggerAlert: (params: { device: Device; widget: ExtendedWidget; value: unknown }) => void;
}
const AlertsContext = createContext<AlertsContextType | null>(null);
const useAlerts = () => useContext(AlertsContext)!;

// =================================================================================
// FUNÇÕES AUXILIARES – TIMESTAMP DO DISPOSITIVO
// =================================================================================

/**
 * Tenta extrair do JSON recebido o timestamp real do dispositivo.
 * Aceita campos: device_timestamp, timestamp, time, ts, lastUpdate, last_update, update.
 * Pode ser número (ms ou segundos) ou string ISO.
 */
const extractDeviceTimestamp = (payload: any): number | null => {
  if (!payload || typeof payload !== 'object') return null;

  const candidates = [
    'device_timestamp',
    'timestamp',
    'time',
    'ts',
    'lastUpdate',
    'last_update',
    'update', // campo usado pelo ESP32 para indicar última atualização
  ];

  for (const key of candidates) {
    const value = (payload as any)[key];
    if (value === undefined || value === null || value === '') continue;

    // Número: pode ser em milissegundos ou segundos (epoch)
    if (typeof value === 'number') {
      const ms = value > 1e12 ? value : value * 1000;
      if (!Number.isNaN(ms) && Number.isFinite(ms)) return ms;
    }

    // String ISO ou similar
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }

  return null;
};

// =================================================================================
// FUNÇÕES AUXILIARES – API BACKEND / MQTT
// =================================================================================

const getApiBaseUrl = (): string => {
  if (typeof window === 'undefined') return 'http://127.0.0.1:5175';

  const host = window.location.hostname;

  if (host === 'localhost' || host === '127.0.0.1') {
    return 'http://127.0.0.1:5175';
  }

  return 'https://api.devices.net.br';
};

const API_BASE_URL = getApiBaseUrl();

const extractDeviceIdFromTopic = (topic?: string): string | null => {
  if (!topic) return null;

  const prefix = 'devices/';
  const suffix = '/telemetry';

  if (topic.startsWith(prefix) && topic.endsWith(suffix)) {
    return topic.slice(prefix.length, -suffix.length);
  }

  return null;
};

const getDeviceBackendId = (device: Device): string => {
  const cfg = (device as any).protocolConfig || {};
  const lastData = (device.lastData || {}) as any;

  return (
    cfg.device_id ||
    lastData.device_id ||
    extractDeviceIdFromTopic(cfg.topic) ||
    device.name
  );
};

const getDeviceDataUrl = (device: Device): string => {
  const deviceId = getDeviceBackendId(device);
  return `${API_BASE_URL}/api/nivel/${encodeURIComponent(deviceId)}`;
};

const normalizeDeviceFromApi = (device: Device, newData: any): Device => {
  const now = Date.now();
  const lastUpdated = Number(newData.last_seen_at || newData.received_at || now);

  const isOnline =
    typeof newData.is_online === 'boolean'
      ? newData.is_online
      : now - lastUpdated <= OFFLINE_THRESHOLD;

  return {
    ...device,
    lastData: newData,
    lastUpdated,
    isOnline,
  };
};

// =================================================================================
// PROVIDERS
// =================================================================================

const I18nProvider = ({ children }: { children: ReactNode }) => {
  const [language, setLanguage] = useState<Language>(Language.EN);
  const t = useCallback(
    (key: string) => translations[language][key] || key,
    [language],
  );
  const value = useMemo(() => ({ language, setLanguage, t }), [language, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const savedUser = localStorage.getItem('user');
      if (savedUser) {
        const parsed = JSON.parse(savedUser) as User;
        setUser(parsed);
      }
    } catch (err) {
      console.error('Erro ao carregar user do localStorage', err);
    }
  }, []);

  const login = async (email: string, pass: string): Promise<boolean> => {
    try {
      const usersWithPasswords = await fetchUsers();
      const matchedUser = usersWithPasswords.find(
        (u) => u.email === email && (u as any).senha === pass,
      );
      if (matchedUser) {
        const userData: User = {
          email: matchedUser.email,
          maxCompanies: matchedUser.maxCompanies,
          maxDevices: matchedUser.maxDevices,
        };
        setUser(userData);
        if (typeof window !== 'undefined') {
          localStorage.setItem('user', JSON.stringify(userData));
        }
        return true;
      }
      return false;
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  };

  const logout = () => {
    setUser(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('user');
    }
  };

  const value = useMemo(() => ({ user, login, logout }), [user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

const AlertsProvider = ({ children }: { children: ReactNode }) => {
  const triggerAlert = useCallback(
    async ({ device, widget, value }: { device: Device; widget: ExtendedWidget; value: unknown }) => {
      const keyInfo = `[Device: ${device.name}] [Widget: ${widget.name}]`;
      console.warn(`${keyInfo} Valor fora da faixa aceitável`, {
        value,
        minAcceptable: widget.minAcceptable ?? null,
        maxAcceptable: widget.maxAcceptable ?? null,
      });

      try {
        const cfg = (device as any).protocolConfig || {};
        if (device.protocol === Protocol.HTTP && cfg.alertUrl) {
          await fetch(cfg.alertUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              deviceId: device.id,
              widgetId: widget.id,
              value,
              minAcceptable: widget.minAcceptable ?? null,
              maxAcceptable: widget.maxAcceptable ?? null,
              createdAt: new Date().toISOString(),
            }),
          });
        }
      } catch (error) {
        console.error(`${keyInfo} Falha ao enviar alerta para o dispositivo`, error);
      }
    },
    [],
  );

  const value = useMemo(() => ({ triggerAlert }), [triggerAlert]);
  return <AlertsContext.Provider value={value}>{children}</AlertsContext.Provider>;
};

const DataProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);

  // Carrega empresas e dispositivos do localStorage por usuário
  useEffect(() => {
    if (!user || typeof window === 'undefined') return;
    const companiesKey = `companies_${user.email}`;
    const devicesKey = `devices_${user.email}`;
    try {
      const savedCompanies = localStorage.getItem(companiesKey);
      const savedDevices = localStorage.getItem(devicesKey);
      setCompanies(savedCompanies ? JSON.parse(savedCompanies) : []);
      setDevices(savedDevices ? JSON.parse(savedDevices) : []);
    } catch (err) {
      console.error('Erro ao carregar companies/devices do localStorage', err);
      setCompanies([]);
      setDevices([]);
    }
  }, [user]);

  // Persiste empresas
  useEffect(() => {
    if (!user || typeof window === 'undefined') return;
    const companiesKey = `companies_${user.email}`;
    localStorage.setItem(companiesKey, JSON.stringify(companies));
  }, [companies, user]);

  // Persiste dispositivos
  useEffect(() => {
    if (!user || typeof window === 'undefined') return;
    const devicesKey = `devices_${user.email}`;
    localStorage.setItem(devicesKey, JSON.stringify(devices));
  }, [devices, user]);

    // ===========================================================
  // TEMPO REAL: RECEBE TELEMETRIA MQTT VIA SSE DO BACKEND
  // ===========================================================
  useEffect(() => {
    if (!user || typeof window === 'undefined') return;

    const eventsUrl = `${API_BASE_URL}/api/events`;
    const source = new EventSource(eventsUrl);

    source.addEventListener('telemetry', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        const deviceId = data.device_id;

        if (!deviceId) return;

        setDevices((currentDevices) =>
          currentDevices.map((device) => {
            const cfg = (device as any).protocolConfig || {};

            const matchesByTopic =
              device.protocol === Protocol.MQTT &&
              cfg.topic &&
              data.mqtt_topic === cfg.topic;

            const matchesByDeviceId =
              device.id === deviceId ||
              device.name === deviceId ||
              cfg.device_id === deviceId;

            if (!matchesByTopic && !matchesByDeviceId) {
              return device;
            }

            return {
              ...device,
              lastData: data,
              lastUpdated: data.received_at || Date.now(),
              isOnline: true,
            };
          }),
        );
      } catch (error) {
        console.error('[SSE] Erro ao processar telemetria', error);
      }
    });

    source.onerror = (error) => {
      console.error('[SSE] Falha na conexão com /api/events', error);
    };

    return () => {
      source.close();
    };
  }, [user]);

  // ===========================================================
  // POLLING: MONITORAMENTO ONLINE/OFFLINE BASEADO EM UPDATE
  // ===========================================================
  useEffect(() => {
    if (!user) return;

    const dataInterval = setInterval(() => {
      setDevices((currentDevices) => {
        const fetchAndUpdateAll = async () => {
          if (currentDevices.length === 0) return;

          const devicePromises = currentDevices.map(async (d): Promise<Device> => {
            if (d.protocol === Protocol.MQTT) {
              try {
                const response = await fetch(getDeviceDataUrl(d), { cache: 'no-store' });

                if (!response.ok) {
                  console.error(`[Device: ${d.name}] MQTT/API error: ${response.status}`);
                  return {
                    ...d,
                    isOnline: false,
                  };
                }

                const newData = await response.json();

                if (
                  typeof newData === 'object' &&
                  newData !== null &&
                  !Array.isArray(newData)
                ) {
                  return normalizeDeviceFromApi(d, newData);
                }

                console.error(`[Device: ${d.name}] Invalid MQTT/API JSON:`, newData);
                return d;
              } catch (error) {
                console.error(`[Device: ${d.name}] Failed to fetch MQTT API data:`, error);
                return {
                  ...d,
                  isOnline: false,
                };
              }
            }

            if (d.protocol === Protocol.HTTP && (d as any).protocolConfig?.url) {
              try {
                const url = (d as any).protocolConfig.url;
                const response = await fetch(url, { cache: 'no-store' });
                if (!response.ok) {
                  console.error(`[Device: ${d.name}] HTTP error: ${response.status}`);
                  return d;
                }

                const newData = await response.json();

                if (
                  typeof newData === 'object' &&
                  newData !== null &&
                  !Array.isArray(newData)
                ) {
                  const now = Date.now();

                  // 1) Tenta usar timestamp do próprio payload (device_timestamp, timestamp, time, ts, lastUpdate, last_update, update)
                  const deviceTs = extractDeviceTimestamp(newData);

                  let lastUpdated = d.lastUpdated || 0;

                  if (deviceTs !== null) {
                    // se o dispositivo manda timestamp de verdade
                    lastUpdated = deviceTs;
                  } else {
                    // 2) Se não tiver timestamp, usa campo "update" como sequência de atualização
                    const prevUpdate = (d.lastData as any)?.update;
                    const newUpdate = (newData as any)?.update;

                    if (newUpdate !== undefined && newUpdate !== null) {
                      if (prevUpdate === undefined || prevUpdate === null) {
                        // nenhum histórico, considera esta a primeira atualização
                        lastUpdated = now;
                      } else if (newUpdate !== prevUpdate) {
                        // update mudou, então houve nova leitura real do ESP32
                        lastUpdated = now;
                      }
                      // se update não mudou, mantém lastUpdated antigo
                    } else {
                      // 3) Sem timestamp e sem update: usa agora como fallback genérico
                      lastUpdated = now;
                    }
                  }

                  const isOnline = now - lastUpdated <= OFFLINE_THRESHOLD;

                  return {
                    ...d,
                    lastData: newData,
                    lastUpdated,
                    isOnline,
                  };
                }

                console.error(
                  `[Device: ${d.name}] Invalid JSON object received:`,
                  newData,
                );
                return d;
              } catch (error) {
                console.error(
                  `[Device: ${d.name}] Failed to fetch or parse data:`,
                  error,
                );
                return d;
              }
            }
            return d;
          });

          const updatedDevices = await Promise.all(devicePromises);
          setDevices(updatedDevices);
        };

        fetchAndUpdateAll();
        return currentDevices;
      });
    }, 3000);

    // Verificação extra de offline baseada em lastUpdated
    const offlineCheckInterval = setInterval(() => {
      const now = Date.now();
      setDevices((prevDevices) =>
        prevDevices.map((d) => {
          if (!d.lastUpdated) return d;
          const diff = now - d.lastUpdated;
          if (diff > OFFLINE_THRESHOLD && d.isOnline) {
            return { ...d, isOnline: false };
          }
          return d;
        }),
      );
    }, 10000);

    return () => {
      clearInterval(dataInterval);
      clearInterval(offlineCheckInterval);
    };
  }, [user]);

  const addCompany = useCallback((name: string) => {
    const newCompany: Company = { id: `comp_${Date.now()}`, name };
    setCompanies((prev) => [...prev, newCompany]);
  }, []);

  const deleteCompany = useCallback((companyId: string) => {
    setCompanies((prev) => prev.filter((c) => c.id !== companyId));
    setDevices((prev) => prev.filter((d) => d.companyId !== companyId));
  }, []);

  const addDevice = useCallback(
    (
      deviceData: Omit<
        Device,
        'id' | 'lastData' | 'lastUpdated' | 'isOnline'
      >,
    ) => {
      try {
        const parsedJson = JSON.parse((deviceData as any).sampleJson);
        const newDevice: Device = {
          ...(deviceData as any),
          id: `dev_${Date.now()}`,
          lastData: parsedJson,
          lastUpdated: 0,
          isOnline: false,
        };
        setDevices((prev) => [...prev, newDevice]);
      } catch (e) {
        console.error('Could not add device due to invalid sample JSON');
      }
    },
    [],
  );

  const deleteDevice = useCallback((deviceId: string) => {
    setDevices((prev) => prev.filter((d) => d.id !== deviceId));
  }, []);

  const value = useMemo(
    () => ({ companies, devices, addCompany, deleteCompany, addDevice, deleteDevice }),
    [companies, devices, addCompany, deleteCompany, addDevice, deleteDevice],
  );
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};

// =================================================================================
// HOOK DE THRESHOLD + ALERTA + FÓRMULA DE ENGENHARIA
// =================================================================================

const applyEngineeringFormula = (widget: ExtendedWidget, numeric: number): number => {
  if (!widget.engFormula || !widget.engFormula.trim()) return numeric;

  try {
    const fn = new Function('x', `return ${widget.engFormula}`) as (x: number) => number;
    const result = fn(numeric);
    if (typeof result === 'number' && !Number.isNaN(result) && Number.isFinite(result)) {
      return result;
    }
    return numeric;
  } catch (err) {
    console.error(`Erro na fórmula de engenharia do widget "${widget.name}"`, err);
    return numeric;
  }
};

const useThresholdAlert = (
  device: Device,
  widget: ExtendedWidget,
  rawValue: unknown,
) => {
  const { triggerAlert } = useAlerts();
  const [hasAlerted, setHasAlerted] = useState(false);

  const baseNumeric =
    typeof rawValue === 'number'
      ? rawValue
      : rawValue !== undefined && rawValue !== null && rawValue !== ''
      ? Number(rawValue)
      : NaN;

  const hasBaseNumeric = !Number.isNaN(baseNumeric);

  const engineeredValue = hasBaseNumeric
    ? applyEngineeringFormula(widget, baseNumeric)
    : NaN;

  const hasNumeric = !Number.isNaN(engineeredValue);

  const min = widget.minAcceptable ?? null;
  const max = widget.maxAcceptable ?? null;

  const isOutOfRange =
    hasNumeric &&
    ((min !== null && engineeredValue < min) ||
      (max !== null && engineeredValue > max));

  useEffect(() => {
    if (isOutOfRange && !hasAlerted) {
      triggerAlert({ device, widget, value: rawValue });
      setHasAlerted(true);
    }
    if (!isOutOfRange && hasAlerted) {
      setHasAlerted(false);
    }
  }, [isOutOfRange, hasAlerted, triggerAlert, device, widget, rawValue]);

  return {
    isOutOfRange,
    numericValue: hasNumeric ? engineeredValue : null,
  };
};

// =================================================================================
// WIDGETS
// =================================================================================

interface WidgetProps {
  device: Device;
  widget: ExtendedWidget;
}

const TankWidget: React.FC<WidgetProps> = ({ device, widget }) => {
  const rawValue = (device.lastData as any)[widget.dataKey] ?? 0;
  const { isOutOfRange, numericValue } = useThresholdAlert(device, widget, rawValue);

  const levelRaw = numericValue ?? 0;
  const level = Math.max(0, Math.min(100, Number(levelRaw)));

  return (
    <div className="flex flex-col items-center justify-center h-full p-4">
      <div
        className={`w-24 h-48 border-4 rounded-lg flex flex-col-reverse relative transition-colors duration-300 ${
          isOutOfRange ? 'border-red-500' : 'border-slate-500'
        }`}
      >
        <div
          className={`rounded-b-md transition-all duration-500 ${
            isOutOfRange ? 'bg-red-500' : 'bg-sky-500'
          }`}
          style={{ height: `${level}%` }}
        />
        <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
          <span className="text-3xl font-bold">{Math.round(level)}%</span>
          {isOutOfRange && (
            <span className="mt-1 text-xs font-semibold bg-red-600 px-2 py-0.5 rounded-full">
              ALERTA
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

const SwitchWidget: React.FC<WidgetProps> = ({ device, widget }) => {
  const rawValue = (device.lastData as any)[widget.dataKey] ?? false;
  const isOn = Boolean(rawValue);
  const { isOutOfRange } = useThresholdAlert(device, widget, rawValue);
  const [pending, setPending] = useState(false);

  const relayMatch = String(widget.dataKey).match(/^relay([1-3])$/);
  const relayNumber = relayMatch ? Number(relayMatch[1]) : null;
  const isRelayCommand = device.protocol === Protocol.MQTT && relayNumber !== null;

  const sendRelayCommand = async () => {
    if (!isRelayCommand || !relayNumber) return;

    const deviceId = getDeviceBackendId(device);
    const nextState = !isOn;

    setPending(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/relay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          device_id: deviceId,
          relay: relayNumber,
          state: nextState,
        }),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok || body?.ok === false) {
        throw new Error(body?.error || `Erro HTTP ${response.status}`);
      }
    } catch (error) {
      console.error(`[Relay] Falha ao comandar ${widget.dataKey}`, error);
      alert(`Falha ao comandar ${widget.name}. Verifique se o server.cjs está rodando.`);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full p-4 gap-4">
      <button
        type="button"
        disabled={!isRelayCommand || pending}
        onClick={sendRelayCommand}
        className={`relative w-28 h-14 rounded-full flex items-center p-1 transition-all duration-300 ${
          isOn ? 'bg-green-500' : 'bg-slate-600'
        } ${
          isRelayCommand
            ? 'cursor-pointer hover:brightness-110'
            : 'cursor-default'
        } ${
          isOutOfRange ? 'ring-2 ring-red-500 ring-offset-2 ring-offset-slate-900' : ''
        } disabled:opacity-70`}
      >
        <div
          className={`w-12 h-12 bg-white rounded-full shadow-lg transition-transform duration-300 ${
            isOn ? 'translate-x-14' : 'translate-x-0'
          }`}
        />
      </button>

      <div className="text-center">
        <div
          className={`text-2xl font-bold ${
            isOn ? 'text-green-400' : 'text-slate-400'
          }`}
        >
          {pending ? '...' : isOn ? 'LIGADO' : 'DESLIGADO'}
        </div>

        {isRelayCommand && (
          <div className="text-[11px] text-slate-500 mt-1">
            Clique para {isOn ? 'desligar' : 'ligar'}
          </div>
        )}

        {!isRelayCommand && (
          <div className="text-[11px] text-slate-500 mt-1">
            Status somente leitura
          </div>
        )}
      </div>

      {isOutOfRange && (
        <span className="text-xs text-red-400 font-semibold">
          Alerta de faixa
        </span>
      )}
    </div>
  );
};

const GaugeWidget: React.FC<WidgetProps> = ({ device, widget }) => {
  const rawValue = (device.lastData as any)[widget.dataKey] ?? 0;
  const { isOutOfRange, numericValue } = useThresholdAlert(device, widget, rawValue);
  const value = numericValue ?? 0;

  return (
    <div className="flex flex-col items-center justify-center h-full p-4">
      <div
        className={`text-5xl sm:text-6xl font-bold ${
          isOutOfRange ? 'text-red-400' : 'text-cyan-400'
        }`}
      >
        {Number(value).toLocaleString(undefined, {
          maximumFractionDigits: 2,
        })}
      </div>
      <div className="text-sm sm:text-base text-slate-400">{widget.unit}</div>
      {isOutOfRange && (
        <div className="mt-2 text-xs text-red-400 font-semibold text-center">
          Fora do limite configurado
        </div>
      )}
    </div>
  );
};

const ValueWidget: React.FC<WidgetProps> = ({ device, widget }) => {
  const rawValue = (device.lastData as any)[widget.dataKey];
  const { isOutOfRange, numericValue } = useThresholdAlert(device, widget, rawValue);

  const value =
    numericValue !== null
      ? String(numericValue)
      : rawValue !== undefined && rawValue !== null
      ? String(rawValue)
      : 'N/A';

  return (
    <div className="flex flex-col items-center justify-center h-full p-4">
      <div className="text-slate-400 text-xs sm:text-sm">{widget.dataKey}</div>
      <div
        className={`mt-2 text-2xl sm:text-4xl font-bold ${
          isOutOfRange ? 'text-red-400' : 'text-white'
        }`}
      >
        {value}
      </div>
      {isOutOfRange && (
        <span className="mt-1 text-[10px] sm:text-xs text-red-400 font-semibold">
          Valor fora da faixa
        </span>
      )}
    </div>
  );
};

const MAX_TREND_POINTS = 20;

const TrendWidget: React.FC<WidgetProps> = ({ device, widget }) => {
  const rawValue = (device.lastData as any)[widget.dataKey];
  const { isOutOfRange, numericValue } = useThresholdAlert(device, widget, rawValue);
  const [series, setSeries] = useState<number[]>([]);

  useEffect(() => {
    if (numericValue == null) return;
    setSeries((prev) => {
      const next = [...prev, numericValue];
      if (next.length > MAX_TREND_POINTS) next.shift();
      return next;
    });
  }, [numericValue]);

  const points = series;
  const max = points.length ? Math.max(...points) : 1;
  const min = points.length ? Math.min(...points) : 0;
  const range = max - min || 1;
  const normalized = points.map((v) => (v - min) / range);

  return (
    <div className="flex flex-col h-40 p-3">
      <div className="flex justify-between text-[10px] text-slate-400 mb-1">
        <span>Últimos {points.length} valores</span>
        {numericValue != null && (
          <span
            className={isOutOfRange ? 'text-red-400 font-semibold' : 'text-cyan-400'}
          >
            {numericValue.toFixed(2)} {widget.unit}
          </span>
        )}
      </div>
      <div className="flex-1 bg-slate-900 rounded-md px-1 py-1 flex items-end gap-[2px]">
        {points.length === 0 ? (
          <span className="text-xs text-slate-500">Sem dados</span>
        ) : (
          normalized.map((v, idx) => (
            <div
              key={idx}
              style={{ height: `${10 + v * 90}%` }}
              className={`flex-1 rounded-sm ${
                isOutOfRange ? 'bg-red-500' : 'bg-sky-500'
              }`}
            />
          ))
        )}
      </div>
    </div>
  );
};

const StatusWidget: React.FC<WidgetProps> = ({ device, widget }) => {
  const rawValue = (device.lastData as any)[widget.dataKey];
  const { isOutOfRange, numericValue } = useThresholdAlert(device, widget, rawValue);
  const min = widget.minAcceptable ?? null;
  const max = widget.maxAcceptable ?? null;

  return (
    <div className="flex flex-col items-center justify-center h-full p-4 gap-2">
      <div
        className={`px-3 py-1 rounded-full text-xs font-semibold ${
          isOutOfRange ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'
        }`}
      >
        {isOutOfRange ? 'EM ALERTA' : 'NORMAL'}
      </div>
      <div className="text-sm text-slate-300 text-center">
        {numericValue != null ? (
          <>
            Valor:{' '}
            <span className="font-semibold">
              {numericValue.toFixed(2)} {widget.unit}
            </span>
          </>
        ) : (
          'Sem leitura'
        )}
      </div>
      {(min !== null || max !== null) && (
        <div className="text-[11px] text-slate-400 text-center">
          Limites:{' '}
          {min !== null ? `≥ ${min}` : ''}{' '}
          {min !== null && max !== null ? ' / ' : ''}
          {max !== null ? `≤ ${max}` : ''}
        </div>
      )}
    </div>
  );
};

const TemperatureGaugeWidget: React.FC<WidgetProps> = ({ device, widget }) => {
  const rawValue = (device.lastData as any)[widget.dataKey] ?? 0;
  const { numericValue, isOutOfRange } = useThresholdAlert(device, widget, rawValue);
  const value = numericValue ?? 0;

  const pct = Math.max(0, Math.min(100, (value / 60) * 100));

  return (
    <div className="flex flex-col items-center justify-center h-full p-3">
      <div className="relative flex flex-col items-center">
        <div className="w-6 h-24 bg-slate-900 rounded-full border border-slate-600 flex flex-col justify-end overflow-hidden">
          <div
            className={`w-full transition-all duration-300 ${
              isOutOfRange ? 'bg-red-500' : 'bg-orange-400'
            }`}
            style={{ height: `${pct}%` }}
          />
        </div>
        <div className="w-8 h-8 bg-slate-900 rounded-full border border-slate-600 -mt-3 flex items-center justify-center">
          <div
            className={`w-5 h-5 rounded-full ${
              isOutOfRange ? 'bg-red-500' : 'bg-orange-400'
            }`}
          />
        </div>
      </div>
      <div className="mt-2 text-xl font-bold text-white">
        {value.toFixed(1)}°C
      </div>
    </div>
  );
};

const HumidityGaugeWidget: React.FC<WidgetProps> = ({ device, widget }) => {
  const rawValue = (device.lastData as any)[widget.dataKey] ?? 0;
  const { numericValue, isOutOfRange } = useThresholdAlert(device, widget, rawValue);
  const value = numericValue ?? 0;
  const pct = Math.max(0, Math.min(100, value));

  return (
    <div className="flex flex-col items-center justify-center h-full p-3">
      <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${
            isOutOfRange ? 'bg-red-500' : 'bg-sky-400'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-2 text-2xl font-bold text-sky-400">
        {value.toFixed(0)}%
      </div>
      <div className="text-xs text-slate-400">Umidade</div>
    </div>
  );
};

const GasGaugeWidget: React.FC<WidgetProps> = ({ device, widget }) => {
  const rawValue = (device.lastData as any)[widget.dataKey] ?? 0;
  const { numericValue, isOutOfRange } = useThresholdAlert(device, widget, rawValue);
  const value = numericValue ?? 0;

  return (
    <div className="flex flex-col items-center justify-center h-full p-3">
      <div
        className={`text-3xl font-bold ${
          isOutOfRange ? 'text-red-400' : 'text-yellow-300'
        }`}
      >
        {value.toFixed(0)} ppm
      </div>
      <div className="text-xs text-slate-400">Nível de gás</div>
    </div>
  );
};

const WaterQualityGaugeWidget: React.FC<WidgetProps> = ({ device, widget }) => {
  const rawValue = (device.lastData as any)[widget.dataKey] ?? 0;
  const { numericValue, isOutOfRange } = useThresholdAlert(device, widget, rawValue);
  const value = numericValue ?? 0;

  let quality = 'Inadequada';
  let color = 'text-red-400';

  if (value < 300) {
    quality = 'Excelente';
    color = 'text-emerald-400';
  } else if (value < 600) {
    quality = 'Boa';
    color = 'text-green-400';
  } else if (value < 900) {
    quality = 'Ruim';
    color = 'text-yellow-300';
  }

  return (
    <div className="flex flex-col items-center justify-center h-full p-3">
      <div className={`text-3xl font-bold ${color}`}>
        {value.toFixed(0)} ppm
      </div>
      <div className="text-xs text-slate-400">{quality}</div>
      {isOutOfRange && (
        <div className="mt-1 text-[10px] text-red-400 font-semibold">
          Fora da faixa alvo
        </div>
      )}
    </div>
  );
};

const widgetComponentMap: Record<WidgetType, React.FC<WidgetProps>> = {
  [WidgetType.Tank]: TankWidget,
  [WidgetType.Switch]: SwitchWidget,
  [WidgetType.Gauge]: GaugeWidget,
  [WidgetType.Value]: ValueWidget,
  [WidgetType.Trend]: TrendWidget,
  [WidgetType.Status]: StatusWidget,
  [WidgetType.TemperatureGauge]: TemperatureGaugeWidget,
  [WidgetType.HumidityGauge]: HumidityGaugeWidget,
  [WidgetType.GasGauge]: GasGaugeWidget,
  [WidgetType.WaterQualityGauge]: WaterQualityGaugeWidget,
};

// =================================================================================
// MODAL DETALHADO DO DISPOSITIVO (PAINEL / GRÁFICOS)
// =================================================================================

interface DeviceDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  device: Device;
}

const DeviceDetailModal: React.FC<DeviceDetailModalProps> = ({
  isOpen,
  onClose,
  device,
}) => {
  const { t } = useI18n();
  const widgets = ((device as any).widgets || []) as ExtendedWidget[];
  const [viewMode, setViewMode] = useState<'widgets' | 'charts'>('widgets');

  if (!isOpen) return null;

  const imageUrl = (device as any).imageUrl as string | undefined;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${device.name} – ${t('dashboard.devices')}`}
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-bold text-white">{device.name}</h3>
          <p className="text-xs text-slate-400">{device.protocol}</p>
          {device.isOnline && (
            <p className="text-xs text-slate-500">
              {t('device.lastUpdate')}:{' '}
              {new Date(device.lastUpdated).toLocaleTimeString(undefined, {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {device.isOnline ? (
            <span className="flex items-center gap-1 text-green-400 text-xs">
              <WifiIcon className="w-4 h-4" />
              Online
            </span>
          ) : (
            <span className="flex items-center gap-1 text-red-400 text-xs">
              <NoWifiIcon className="w-4 h-4" />
              {t('device.offline')}
            </span>
          )}
        </div>
      </div>

      {imageUrl && (
        <div className="w-full flex justify-center mb-4">
          <img
            src={imageUrl}
            alt={device.name}
            className="max-h-40 object-contain rounded-md border border-slate-700 bg-slate-900 p-2"
          />
        </div>
      )}

      <div className="flex justify-center mb-4 gap-2">
        <button
          className={`px-3 py-1 text-xs rounded-full border ${
            viewMode === 'widgets'
              ? 'bg-sky-600 border-sky-500 text-white'
              : 'bg-slate-700 border-slate-600 text-slate-200'
          }`}
          onClick={() => setViewMode('widgets')}
        >
          Painel
        </button>
        <button
          className={`px-3 py-1 text-xs rounded-full border ${
            viewMode === 'charts'
              ? 'bg-sky-600 border-sky-500 text-white'
              : 'bg-slate-700 border-slate-600 text-slate-200'
          }`}
          onClick={() => setViewMode('charts')}
        >
          Gráficos
        </button>
      </div>

      {viewMode === 'widgets' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {widgets.map((widget) => {
            const WidgetComponent = widgetComponentMap[widget.type];
            return (
              <div
                key={widget.id}
                className="bg-slate-900 rounded-md p-3 flex flex-col"
              >
                <h4 className="text-xs text-center text-slate-400 font-semibold mb-1 truncate">
                  {widget.name}
                </h4>
                <div className="flex-grow">
                  {WidgetComponent && (
                    <WidgetComponent
                      device={device}
                      widget={widget as ExtendedWidget}
                    />
                  )}
                </div>
              </div>
            );
          })}
          {widgets.length === 0 && (
            <p className="text-xs text-slate-500 text-center col-span-full">
              {t('dashboard.noDevices')}
            </p>
          )}
        </div>
      )}

      {viewMode === 'charts' && (
        <div className="space-y-3">
          {widgets.map((widget) => (
            <div
              key={widget.id}
              className="bg-slate-900 rounded-md p-3 flex flex-col"
            >
              <h4 className="text-xs text-slate-400 font-semibold mb-2">
                {widget.name} – {widget.dataKey}
              </h4>
              <TrendWidget device={device} widget={widget as ExtendedWidget} />
            </div>
          ))}
          {widgets.length === 0 && (
            <p className="text-xs text-slate-500 text-center">
              Nenhum widget configurado para gráficos.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
};

// =================================================================================
// DEVICE CARD
// =================================================================================


const DeviceCard: React.FC<{ device: Device }> = ({ device }) => {
  const { t } = useI18n();
  const { deleteDevice } = useData();
  const [isJsonModalOpen, setJsonModalOpen] = useState(false);
  const [isDetailOpen, setDetailOpen] = useState(false);

  const hasAnyAlert = useMemo(() => {
    const widgets = (device as any).widgets as ExtendedWidget[] | undefined;
    if (!widgets || !Array.isArray(widgets)) return false;

    return widgets.some((w) => {
      const rawValue = (device.lastData as any)[w.dataKey];
      const baseNumeric =
        typeof rawValue === 'number'
          ? rawValue
          : rawValue != null
          ? Number(rawValue)
          : NaN;
      if (Number.isNaN(baseNumeric)) return false;

      const engineered = applyEngineeringFormula(w, baseNumeric);
      const min = w.minAcceptable ?? null;
      const max = w.maxAcceptable ?? null;

      return (
        ((min !== null && engineered < min) || (max !== null && engineered > max))
      );
    });
  }, [device]);

  const widgets = ((device as any).widgets || []) as ExtendedWidget[];
  const imageUrl = (device as any).imageUrl as string | undefined;

  const handleCardClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('svg')) return;
    setDetailOpen(true);
  };

  return (
    <>
      <div
        className={`bg-slate-800 rounded-lg shadow-lg relative col-span-1 row-span-1 flex flex-col transition-opacity	duration-500 ${
          !device.isOnline ? 'opacity-50' : ''
        }`}
      >
        <div className="p-3 border-b border-slate-700 flex justify-between items-start">
          <div className="space-y-1">
            <h3 className="font-bold text-white text-sm sm:text-base">
              {device.name}
            </h3>
            <p className="text-[10px] sm:text-xs text-slate-400">
              {device.protocol}
            </p>
            {device.lastUpdated > 0 && (
              <p className="text-[10px] sm:text-xs text-slate-500">
                {t('device.lastUpdate')}:{' '}
                {new Date(device.lastUpdated).toLocaleTimeString(undefined, {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {hasAnyAlert && (
              <span className="px-2 py-1 rounded-full bg-red-600 text-[10px] text-white font-semibold">
                ALERTA
              </span>
            )}
            {device.isOnline ? (
              <div className="flex items-center gap-1 text-green-400 text-[10px] sm:text-xs">
                <WifiIcon className="w-4 h-4" />
                <span>Online</span>
              </div>
            ) : (
              <div className="flex items-center gap-1 text-red-400 text-[10px] sm:text-xs">
                <NoWifiIcon className="w-4 h-4" />
                <span>{t('device.offline')}</span>
              </div>
            )}
            <button
              onClick={() => setJsonModalOpen(true)}
              className="text-slate-500 hover:text-sky-400 transition-colors"
              title={t('device.viewJson')}
            >
              <CodeBracketIcon className="w-4 h-4" />
            </button>
            <button
              onClick={() => deleteDevice(device.id)}
              className="text-slate-500 hover:text-red-500 transition-colors"
            >
              <TrashIcon className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div
          className="flex-1 flex flex-col cursor-pointer min-h-[260px]"
          onClick={handleCardClick}
        >
          {imageUrl && (
            <div className="w-full border-b border-slate-700 bg-slate-900 flex justify-center">
              <img
                src={imageUrl}
                alt={device.name}
                className="max-h-24 object-contain p-2"
              />
            </div>
          )}

          {widgets.length === 0 ? (
            <div className="flex-grow flex items-center justify-center text-slate-500 text-xs sm:text-sm">
              No widgets configured.
            </div>
          ) : (
            <div className="p-2 flex-grow grid grid-cols-1 gap-2">
              {widgets.slice(0, 2).map((widget) => {
                const WidgetComponent = widgetComponentMap[widget.type];
                return (
                  <div
                    key={widget.id}
                    className="bg-slate-900 rounded-md p-2 flex flex-col"
                  >
                    <h4 className="text-[11px] text-center text-slate-400 font-semibold mb-1 truncate">
                      {widget.name}
                    </h4>
                    <div className="flex-grow">
                      {WidgetComponent && (
                        <WidgetComponent
                          device={device}
                          widget={widget as ExtendedWidget}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <JsonViewerModal
        isOpen={isJsonModalOpen}
        onClose={() => setJsonModalOpen(false)}
        data={device.lastData}
      />

      <DeviceDetailModal
        isOpen={isDetailOpen}
        onClose={() => setDetailOpen(false)}
        device={device}
      />
    </>
  );
};

// =================================================================================
// MODAIS
// =================================================================================

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  title: string;
}

const Modal: React.FC<ModalProps> = ({ isOpen, onClose, children, title }) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-800 rounded-lg shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-slate-700">
          <h2 className="text-xl font-bold text-white">{title}</h2>
        </div>
        <div className="p-6 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
};

const AddCompanyModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useI18n();
  const { user } = useAuth();
  const { companies, addCompany } = useData();
  const [name, setName] = useState('');

  const canAddCompany = user && companies.length < user.maxCompanies;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim() && canAddCompany) {
      addCompany(name.trim());
      setName('');
      onClose();
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('modal.addCompany.title')}>
      {canAddCompany ? (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="companyName"
              className="block text-sm font-medium text-slate-300"
            >
              {t('modal.addCompany.name')}
            </label>
            <input
              type="text"
              id="companyName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 block w-full bg-slate-700 border border-slate-600 rounded-md shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-sky-500 focus:border-sky-500 sm:text-sm"
              required
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-600 rounded-md hover:bg-slate-500 transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-sky-600 rounded-md hover:bg-sky-500 transition-colors"
            >
              {t('common.create')}
            </button>
          </div>
        </form>
      ) : (
        <p className="text-red-400">{t('modal.addCompany.limit')}</p>
      )}
    </Modal>
  );
};

const AddDeviceModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  companyId: string | null;
}> = ({ isOpen, onClose, companyId }) => {
  const { t } = useI18n();
  const { user } = useAuth();
  const { devices, addDevice } = useData();
  const [step, setStep] = useState(1);

  const [name, setName] = useState('');
  const [protocol, setProtocol] = useState<Protocol>(Protocol.HTTP);
  const [protocolConfig, setProtocolConfig] = useState<Record<string, string>>({});
  const [imageUrl, setImageUrl] = useState('');

  const [sampleJson, setSampleJson] = useState(
    '{\n  "device_id": "predio/torreA/sub1/reservatorio1",\n  "nivel_pct": 75,\n  "power_on": true,\n  "temperature": 22.5,\n  "gas_level": 300,\n  "wifi_rssi": -54,\n  "update": 1717000000\n}',
  );
  const [parsedKeys, setParsedKeys] = useState<string[]>([]);
  const [jsonError, setJsonError] = useState('');
  const [widgets, setWidgets] = useState<Omit<ExtendedWidget, 'id'>[]>([]);

  useEffect(() => {
    try {
      const parsed = JSON.parse(sampleJson);
      setParsedKeys(Object.keys(parsed));
      setJsonError('');
    } catch {
      setParsedKeys([]);
      setJsonError(t('modal.addDevice.parseError'));
    }
  }, [sampleJson, t]);

  const resetState = () => {
    setStep(1);
    setName('');
    setProtocol(Protocol.HTTP);
    setProtocolConfig({});
    setImageUrl('');
    setSampleJson(
      '{\n  "device_id": "predio/torreA/sub1/reservatorio1",\n  "nivel_pct": 75,\n  "power_on": true,\n  "temperature": 22.5,\n  "gas_level": 300,\n  "wifi_rssi": -54,\n  "update": 1717000000\n}',
    );
    setWidgets([]);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleSubmit = () => {
    if (!companyId) return;

    const widgetsWithId = widgets.map((w) => ({
      ...w,
      id: `widget_${Date.now()}_${Math.random()}`,
    }));

    addDevice({
      companyId,
      name,
      protocol,
      protocolConfig,
      sampleJson,
      widgets: widgetsWithId as any,
      imageUrl,
    } as any);

    handleClose();
  };

  const canAddDevice = user && devices.length < user.maxDevices;

  const renderProtocolFields = () => {
    switch (protocol) {
      case Protocol.HTTP:
        return (
          <div>
            <label className="block text-sm font-medium text-slate-300">
              {t('modal.addDevice.http.url')}
            </label>
            <input
              type="text"
              value={protocolConfig.url || ''}
              onChange={(e) => setProtocolConfig({ url: e.target.value })}
              placeholder="/api/devices/reservatorio1/nivel"
              className="mt-1 block w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3"
            />
          </div>
        );
      case Protocol.MQTT:
        return (
          <>
            <div>
              <label className="block text-sm font-medium text-slate-300">
                {t('modal.addDevice.mqtt.broker')}
              </label>
              <input
                type="text"
                value={protocolConfig.broker || ''}
                onChange={(e) =>
                  setProtocolConfig((p) => ({ ...p, broker: e.target.value }))
                }
                className="mt-1 block w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300">
                {t('modal.addDevice.mqtt.topic')}
              </label>
              <input
                type="text"
                value={protocolConfig.topic || ''}
                onChange={(e) =>
                  setProtocolConfig((p) => ({ ...p, topic: e.target.value }))
                }
                className="mt-1 block w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3"
              />
            </div>
          </>
        );
      case Protocol.FTP:
        return (
          <>
            <div>
              <label className="block text-sm font-medium text-slate-300">
                {t('modal.addDevice.ftp.server')}
              </label>
              <input
                type="text"
                value={protocolConfig.server || ''}
                onChange={(e) =>
                  setProtocolConfig((p) => ({ ...p, server: e.target.value }))
                }
                className="mt-1 block w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300">
                {t('modal.addDevice.ftp.path')}
              </label>
              <input
                type="text"
                value={protocolConfig.path || ''}
                onChange={(e) =>
                  setProtocolConfig((p) => ({ ...p, path: e.target.value }))
                }
                className="mt-1 block w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3"
              />
            </div>
          </>
        );
      default:
        return null;
    }
  };

  const handleAddWidget = () => {
    setWidgets((prev) => [
      ...prev,
      {
        name: 'New Widget',
        type: WidgetType.Value,
        dataKey: '',
        unit: '',
        minAcceptable: null,
        maxAcceptable: null,
        engFormula: '',
      },
    ]);
  };

  const handleWidgetChange = <
    K extends keyof Omit<ExtendedWidget, 'id'>
  >(
    index: number,
    field: K,
    value: Omit<ExtendedWidget, 'id'>[K],
  ) => {
    setWidgets((prev) => {
      const copy = [...prev];
      (copy[index] as any)[field] = value;
      return copy;
    });
  };

  const handleDeleteWidget = (index: number) => {
    setWidgets((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={t('modal.addDevice.title')}>
      {!canAddDevice ? (
        <p className="text-red-400">{t('modal.addDevice.limit')}</p>
      ) : (
        <div className="space-y-4">
          <div className="flex justify-between items-center mb-6">
            <div
              className={`text-center ${
                step >= 1 ? 'text-sky-400' : 'text-slate-500'
              }`}
            >
              <div
                className={`w-8 h-8 mx-auto rounded-full border-2 flex items-center justify-center ${
                  step >= 1 ? 'border-sky-400' : 'border-slate-500'
                }`}
              >
                1
              </div>
              <p className="text-xs mt-1">{t('modal.addDevice.step1')}</p>
            </div>
            <div
              className={`flex-grow h-px ${
                step >= 2 ? 'bg-sky-400' : 'bg-slate-500'
              }`}
            />
            <div
              className={`text-center ${
                step >= 2 ? 'text-sky-400' : 'text-slate-500'
              }`}
            >
              <div
                className={`w-8 h-8 mx-auto rounded-full border-2 flex items-center justify-center ${
                  step >= 2 ? 'border-sky-400' : 'border-slate-500'
                }`}
              >
                2
              </div>
              <p className="text-xs mt-1">{t('modal.addDevice.step2')}</p>
            </div>
            <div
              className={`flex-grow h-px ${
                step >= 3 ? 'bg-sky-400' : 'bg-slate-500'
              }`}
            />
            <div
              className={`text-center ${
                step >= 3 ? 'text-sky-400' : 'text-slate-500'
              }`}
            >
              <div
                className={`w-8 h-8 mx-auto rounded-full border-2 flex items-center justify-center ${
                  step >= 3 ? 'border-sky-400' : 'border-slate-500'
                }`}
              >
                3
              </div>
              <p className="text-xs mt-1">{t('modal.addDevice.step3')}</p>
            </div>
          </div>

          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300">
                  {t('modal.addDevice.name')}
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 block w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300">
                  {t('modal.addDevice.protocol')}
                </label>
                <select
                  value={protocol}
                  onChange={(e) => setProtocol(e.target.value as Protocol)}
                  className="mt-1 block w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3"
                >
                  {Object.values(Protocol).map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300">
                  URL da imagem do dispositivo
                </label>
                <input
                  type="text"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://meuservidor.com/imagem.png"
                  className="mt-1 block w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3"
                />
              </div>
            </div>
          )}

          {step === 2 && <div className="space-y-4">{renderProtocolFields()}</div>}

          {step === 3 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300">
                  {t('modal.addDevice.sampleJson')}
                </label>
                <textarea
                  value={sampleJson}
                  onChange={(e) => setSampleJson(e.target.value)}
                  rows={8}
                  className="font-mono mt-1 block w-full bg-slate-900 border border-slate-600 rounded-md py-2 px-3 text-sm"
                />
                {jsonError && (
                  <p className="text-red-400 text-xs mt-1">{jsonError}</p>
                )}
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-2">
                  {t('modal.addDevice.widgets')}
                </h3>
                <div className="space-y-3 max-h-60 overflow-y-auto pr-2">
                  {widgets.map((w, i) => (
                    <div
                      key={i}
                      className="bg-slate-700 p-3 rounded-md space-y-2 relative"
                    >
                      <button
                        onClick={() => handleDeleteWidget(i)}
                        className="absolute top-2 right-2 text-slate-400 hover:text-red-500"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs">
                            {t('modal.addDevice.widget.name')}
                          </label>
                          <input
                            type="text"
                            value={w.name}
                            onChange={(e) =>
                              handleWidgetChange(i, 'name', e.target.value)
                            }
                            className="w-full bg-slate-600 border-slate-500 rounded text-sm p-1"
                          />
                        </div>
                        <div>
                          <label className="text-xs">
                            {t('modal.addDevice.widget.type')}
                          </label>
                          <select
                            value={w.type}
                            onChange={(e) =>
                              handleWidgetChange(
                                i,
                                'type',
                                e.target.value as any,
                              )
                            }
                            className="w-full bg-slate-600 border-slate-500 rounded text-sm p-1"
                          >
                            {Object.values(WidgetType).map((wt) => (
                              <option key={wt} value={wt}>
                                {t(
                                  `widget.${String(wt)
                                    .toLowerCase()
                                    .replace(' ', '')}`,
                                )}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs">
                            {t('modal.addDevice.widget.dataKey')}
                          </label>
                          <select
                            value={w.dataKey}
                            onChange={(e) =>
                              handleWidgetChange(i, 'dataKey', e.target.value)
                            }
                            className="w-full bg-slate-600 border-slate-500 rounded text-sm p-1"
                            disabled={parsedKeys.length === 0}
                          >
                            <option value="">Selecione uma chave</option>
                            {parsedKeys.length > 0 ? (
                              parsedKeys.map((k) => (
                                <option key={k} value={k}>
                                  {k}
                                </option>
                              ))
                            ) : (
                              <option disabled>
                                {t('modal.addDevice.widget.noKeys')}
                              </option>
                            )}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs">
                            {t('modal.addDevice.widget.unit')}
                          </label>
                          <input
                            type="text"
                            value={w.unit || ''}
                            onChange={(e) =>
                              handleWidgetChange(i, 'unit', e.target.value)
                            }
                            className="w-full bg-slate-600 border-slate-500 rounded text-sm p-1"
                            placeholder="e.g. °C, %, m, L"
                          />
                        </div>
                        <div>
                          <label className="text-xs">Valor mínimo aceitável</label>
                          <input
                            type="number"
                            value={w.minAcceptable ?? ''}
                            onChange={(e) =>
                              handleWidgetChange(
                                i,
                                'minAcceptable',
                                e.target.value === ''
                                  ? null
                                  : Number(e.target.value),
                              )
                            }
                            className="w-full bg-slate-600 border-slate-500 rounded text-sm p-1"
                          />
                        </div>
                        <div>
                          <label className="text-xs">Valor máximo aceitável</label>
                          <input
                            type="number"
                            value={w.maxAcceptable ?? ''}
                            onChange={(e) =>
                              handleWidgetChange(
                                i,
                                'maxAcceptable',
                                e.target.value === ''
                                  ? null
                                  : Number(e.target.value),
                              )
                            }
                            className="w-full bg-slate-600 border-slate-500 rounded text-sm p-1"
                          />
                        </div>
                        <div className="col-span-2">
                          <label className="text-xs">
                            Fórmula de unidade de engenharia (use x)
                          </label>
                          <input
                            type="text"
                            value={w.engFormula ?? ''}
                            onChange={(e) =>
                              handleWidgetChange(i, 'engFormula', e.target.value)
                            }
                            className="w-full bg-slate-600 border-slate-500 rounded text-sm p-1"
                            placeholder="Ex.: x * 0.25 + 10"
                          />
                          <p className="text-[10px] text-slate-300 mt-1">
                            O valor bruto recebido entra como <strong>x</strong>. A
                            saída da fórmula será usada nos gráficos, gauges e limites.
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={handleAddWidget}
                  className="mt-2 w-full text-sm py-2 bg-slate-600 hover:bg-slate-500 rounded-md transition-colors"
                >
                  {t('modal.addDevice.addWidget')}
                </button>
              </div>
            </div>
          )}

          <div className="flex justify-between mt-6">
            <button
              onClick={() => setStep((s) => s - 1)}
              disabled={step === 1}
              className="px-4 py-2 bg-slate-600 rounded-md hover:bg-slate-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('common.back')}
            </button>
            {step < 3 && (
              <button
                onClick={() => setStep((s) => s + 1)}
                className="px-4 py-2 bg-sky-600 rounded-md hover:bg-sky-500"
              >
                {t('common.next')}
              </button>
            )}
            {step === 3 && (
              <button
                onClick={handleSubmit}
                className="px-4 py-2 bg-green-600 rounded-md hover:bg-green-500"
              >
                {t('common.finish')}
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
};

const JsonViewerModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  data: object;
}> = ({ isOpen, onClose, data }) => {
  const { t } = useI18n();
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('modal.jsonViewer.title')}>
      <div className="bg-slate-900 p-4 rounded-md max-h-[60vh] overflow-y-auto">
        <pre className="text-sm text-green-300 whitespace-pre-wrap break-all">
          <code>{JSON.stringify(data, null, 2)}</code>
        </pre>
      </div>
      <div className="flex justify-end mt-4">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 bg-slate-600 rounded-md hover:bg-slate-500 transition-colors"
        >
          {t('common.close')}
        </button>
      </div>
    </Modal>
  );
};

// =================================================================================
// LAYOUT
// =================================================================================

const Header: React.FC = () => {
  const { t, language, setLanguage } = useI18n();
  const { user, logout } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);

  return (
    <header className="bg-slate-800 shadow-md p-4 flex justify-between items-center z-10">
      <h1 className="text-2xl font-bold text-white">{t('header.title')}</h1>
      <div className="flex items-center gap-4">
        <div className="relative">
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-2 text-slate-300 hover:text-white"
          >
            <GlobeAltIcon className="w-5 h-5" />
            <span>{language.toUpperCase()}</span>
            <ChevronDownIcon className="w-4 h-4" />
          </button>
          {dropdownOpen && (
            <div className="absolute right-0 mt-2 w-32 bg-slate-700 rounded-md shadow-lg py-1">
              {Object.values(Language).map((lang) => (
                <a
                  href="#"
                  key={lang}
                  onClick={(e) => {
                    e.preventDefault();
                    setLanguage(lang);
                    setDropdownOpen(false);
                  }}
                  className="block px-4 py-2 text-sm text-slate-200 hover:bg-slate-600"
                >
                  {lang.toUpperCase()}
                </a>
              ))}
            </div>
          )}
        </div>
        {user && (
          <>
            <span className="text-sm text-slate-400">{user.email}</span>
            <button
              onClick={logout}
              className="px-3 py-1 bg-red-600 text-white rounded-md text-sm hover:bg-red-500 transition-colors"
            >
              {t('header.logout')}
            </button>
          </>
        )}
      </div>
    </header>
  );
};

const Sidebar: React.FC<{
  selectedCompany: string | null;
  setSelectedCompany: (id: string | null) => void;
}> = ({ selectedCompany, setSelectedCompany }) => {
  const { t } = useI18n();
  const { user } = useAuth();
  const { companies, devices, deleteCompany } = useData();
  const [isCompanyModalOpen, setCompanyModalOpen] = useState(false);

  return (
    <>
      <aside className="bg-slate-800 w-full md:w-64 p-4 flex flex-col md:h-full md:shrink-0">
        <h2 className="text-lg font-semibold mb-4">
          {t('sidebar.companies')} ({companies.length}/{user?.maxCompanies})
        </h2>
        <nav className="flex-grow overflow-y-auto">
          <ul className="space-y-1">
            {companies.map((company) => (
              <li key={company.id}>
                <div className="flex items-center gap-2">
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setSelectedCompany(company.id);
                    }}
                    className={`flex-1 flex items	center gap-3 px-3 py-2 rounded-md transition-colors ${
                      selectedCompany === company.id
                        ? 'bg-sky-600 text-white'
                        : 'text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    <BuildingOfficeIcon className="w-5 h-5" />
                    <span className="truncate">{company.name}</span>
                  </a>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const confirmDelete = window.confirm(
                        `Remover empresa "${company.name}" e todos os dispositivos vinculados?`,
                      );
                      if (!confirmDelete) return;
                      deleteCompany(company.id);
                      if (selectedCompany === company.id) {
                        setSelectedCompany(null);
                      }
                    }}
                    className="text-slate-500 hover:text-red-500 transition-colors"
                    title="Apagar empresa"
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-4 pt-4 border-t border-slate-700">
          <button
            onClick={() => setCompanyModalOpen(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-green-600 text-white rounded-md hover:bg-green-500 transition-colors"
          >
            <PlusIcon className="w-5 h-5" />
            <span>{t('sidebar.addCompany')}</span>
          </button>
          <div className="text-center text-xs text-slate-400 mt-4">
            {t('sidebar.deviceCount')}: {devices.length}/{user?.maxDevices}
          </div>
        </div>
      </aside>
      <AddCompanyModal
        isOpen={isCompanyModalOpen}
        onClose={() => setCompanyModalOpen(false)}
      />
    </>
  );
};

const Dashboard: React.FC = () => {
  const { t } = useI18n();
  const { devices } = useData();
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [isDeviceModalOpen, setDeviceModalOpen] = useState(false);

  const devicesForCompany = useMemo(() => {
    if (!selectedCompany) return [];
    return devices.filter((d) => d.companyId === selectedCompany);
  }, [devices, selectedCompany]);

  return (
    <div className="min-h-screen w-full flex flex-col bg-slate-900">
      <Header />
      <div className="flex flex-grow overflow-hidden flex-col md:flex-row">
        <Sidebar
          selectedCompany={selectedCompany}
          setSelectedCompany={setSelectedCompany}
        />
        <main className="flex-grow p-4 sm:p-6 overflow-y-auto">
          {selectedCompany ? (
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-3">
                <h2 className="text-2xl font-bold">{t('dashboard.devices')}</h2>
                <button
                  onClick={() => setDeviceModalOpen(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-sky-600 text-white rounded-md hover:bg-sky-500 transition-colors w-full sm:w-auto justify-center"
                >
                  <PlusIcon className="w-5 h-5" />
                  {t('dashboard.addDevice')}
                </button>
              </div>
              {devicesForCompany.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4 sm:gap-6">
                  {devicesForCompany.map((device) => (
                    <DeviceCard key={device.id} device={device} />
                  ))}
                </div>
              ) : (
                <div className="text-center text-slate-500 mt-20">
                  <p>{t('dashboard.noDevices')}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center text-slate-500 mt-20">
              <p>{t('dashboard.selectCompany')}</p>
            </div>
          )}
        </main>
      </div>
      <AddDeviceModal
        isOpen={isDeviceModalOpen}
        onClose={() => setDeviceModalOpen(false)}
        companyId={selectedCompany}
      />
    </div>
  );
};

const Login: React.FC = () => {
  const { t } = useI18n();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      const success = await login(email, password);
      if (!success) {
        setError(t('login.error'));
      }
    } catch {
      setError(t('login.fetchError'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 px-4">
      <div className="max-w-md w-full bg-slate-800 p-8 rounded-lg shadow-lg">
        <h2 className="text-3xl font-bold text-center text-white mb-6">
          {t('login.title')}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-slate-300"
            >
              {t('login.email')}
            </label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full bg-slate-700 border border-slate-600 rounded-md shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-sky-500 focus:border-sky-500 sm:text-sm"
              required
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-slate-300"
            >
              {t('login.password')}
            </label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full bg-slate-700 border border-slate-600 rounded-md shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-sky-500 focus:border-sky-500 sm:text-sm"
              required
            />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <div>
            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-sky-600 hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500 disabled:bg-sky-800 disabled:cursor-not-allowed"
            >
              {isLoading ? t('login.authenticating') : t('login.button')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// =================================================================================
// APP
// =================================================================================

export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <AlertsProvider>
          <AppContent />
        </AlertsProvider>
      </AuthProvider>
    </I18nProvider>
  );
}

function AppContent() {
  const { user } = useAuth();

  if (user) {
    return (
      <DataProvider>
        <Dashboard />
      </DataProvider>
    );
  }

  return <Login />;
}
