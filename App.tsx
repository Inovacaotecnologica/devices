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
// TIPAGEM LOCAL ESTENDIDA (THRESHOLDS POR WIDGET)
// =================================================================================

type ExtendedWidget = Widget & {
  minAcceptable?: number | null;
  maxAcceptable?: number | null;
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

  // Carrega usuário do localStorage ao montar
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
      // Mantém companies/devices para o usuário, apaga apenas o user atual
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

      // Integração opcional com o dispositivo (ex.: endpoint de alerta HTTP)
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

  // Carrega empresas e dispositivos do localStorage quando o usuário é definido
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

  // Salva empresas por usuário
  useEffect(() => {
    if (!user || typeof window === 'undefined') return;
    const companiesKey = `companies_${user.email}`;
    localStorage.setItem(companiesKey, JSON.stringify(companies));
  }, [companies, user]);

  // Salva dispositivos por usuário
  useEffect(() => {
    if (!user || typeof window === 'undefined') return;
    const devicesKey = `devices_${user.email}`;
    localStorage.setItem(devicesKey, JSON.stringify(devices));
  }, [devices, user]);

  // Polling de dados
  useEffect(() => {
    const dataInterval = setInterval(() => {
      setDevices((currentDevices) => {
        const fetchAndUpdateAll = async () => {
          if (currentDevices.length === 0) return;

          const devicePromises = currentDevices.map(async (d): Promise<Device> => {
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
                  const rssiOk =
                    typeof newData.wifi_rssi === 'number' && newData.wifi_rssi < 0;
                  const isOnline = true || rssiOk;
                  return { ...d, lastData: newData, lastUpdated: now, isOnline };
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

    const offlineCheckInterval = setInterval(() => {
      setDevices((prevDevices) =>
        prevDevices.map((d) => {
          if (d.isOnline && Date.now() - d.lastUpdated > OFFLINE_THRESHOLD) {
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
  }, []);

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
// HOOK DE THRESHOLD + ALERTA
// =================================================================================

const useThresholdAlert = (
  device: Device,
  widget: ExtendedWidget,
  rawValue: unknown,
) => {
  const { triggerAlert } = useAlerts();
  const [hasAlerted, setHasAlerted] = useState(false);

  const numericValue =
    typeof rawValue === 'number'
      ? rawValue
      : rawValue !== undefined && rawValue !== null && rawValue !== ''
      ? Number(rawValue)
      : NaN;

  const hasNumeric = !Number.isNaN(numericValue);
  const min = widget.minAcceptable ?? null;
  const max = widget.maxAcceptable ?? null;

  const isOutOfRange =
    hasNumeric &&
    ((min !== null && numericValue < min) ||
      (max !== null && numericValue > max));

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
    numericValue: hasNumeric ? numericValue : null,
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

  return (
    <div className="flex flex-col items-center justify-center h-full p-4 gap-4">
      <div
        className={`w-24 h-12 rounded-full flex items-center p-1 cursor-default transition-colors duration-300 ${
          isOn ? 'bg-green-500 justify-end' : 'bg-slate-600 justify-start'
        } ${isOutOfRange ? 'ring-2 ring-red-500 ring-offset-2 ring-offset-slate-900' : ''}`}
      >
        <div className="w-10 h-10 bg-white rounded-full shadow-lg" />
      </div>
      <div
        className={`text-2xl font-bold ${
          isOn ? 'text-green-400' : 'text-slate-400'
        }`}
      >
        {isOn ? 'ON' : 'OFF'}
      </div>
      {isOutOfRange && (
        <span className="text-xs text-red-400 font-semibold">Alerta de faixa</span>
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
  const { isOutOfRange } = useThresholdAlert(device, widget, rawValue);
  const value = rawValue !== undefined && rawValue !== null ? String(rawValue) : 'N/A';

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

// ===================== NOVOS WIDGETS PROFISSIONAIS ======================

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
    <div className="flex flex-col h-full p-3">
      <div className="flex justify-between text-[10px] text-slate-400 mb-1">
        <span>Últimos {points.length} valores</span>
        {numericValue != null && (
          <span
            className={
              isOutOfRange ? 'text-red-400 font-semibold' : 'text-cyan-400'
            }
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

// ATENÇÃO: para usar Trend e Status, inclua esses valores no enum WidgetType em ./types
const widgetComponentMap: Record<WidgetType, React.FC<WidgetProps>> = {
  [WidgetType.Tank]: TankWidget,
  [WidgetType.Switch]: SwitchWidget,
  [WidgetType.Gauge]: GaugeWidget,
  [WidgetType.Value]: ValueWidget,
  [WidgetType.Trend]: TrendWidget,
  [WidgetType.Status]: StatusWidget,
};

// =================================================================================
// DEVICE CARD
// =================================================================================

const DeviceCard: React.FC<{ device: Device }> = ({ device }) => {
  const { t } = useI18n();
  const { deleteDevice } = useData();
  const [isJsonModalOpen, setJsonModalOpen] = useState(false);

  const hasAnyAlert = useMemo(() => {
    const widgets = (device as any).widgets as ExtendedWidget[] | undefined;
    if (!widgets || !Array.isArray(widgets)) return false;

    return widgets.some((w) => {
      const rawValue = (device.lastData as any)[w.dataKey];
      const numeric =
        typeof rawValue === 'number'
          ? rawValue
          : rawValue != null
          ? Number(rawValue)
          : NaN;
      const hasNumeric = !Number.isNaN(numeric);
      const min = w.minAcceptable ?? null;
      const max = w.maxAcceptable ?? null;
      return (
        hasNumeric &&
        ((min !== null && numeric < min) || (max !== null && numeric > max))
      );
    });
  }, [device]);

  const widgets = ((device as any).widgets || []) as ExtendedWidget[];

  return (
    <>
      <div
        className={`bg-slate-800 rounded-lg shadow-lg relative col-span-1 row-span-1 flex flex-col transition-opacity duração-500 ${
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
            {device.isOnline && (
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
        {widgets.length === 0 ? (
          <div className="flex-grow flex items-center justify-center text-slate-500 text-xs sm:text-sm">
            No widgets configured.
          </div>
        ) : (
          <div className="p-2 flex-grow grid grid-cols-1 sm:grid-cols-2 gap-2">
            {widgets.map((widget) => {
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
      <JsonViewerModal
        isOpen={isJsonModalOpen}
        onClose={() => setJsonModalOpen(false)}
        data={device.lastData}
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
        className="bg-slate-800 rounded-lg shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-slate-700">
          <h2 className="text-xl font-bold">{title}</h2>
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

  const [sampleJson, setSampleJson] = useState(
    '{\n  "device_id": "predio/torreA/sub1/reservatorio1",\n  "nivel_pct": 75,\n  "power_on": true,\n  "temperature": 22.5,\n  "gas_level": 300,\n  "wifi_rssi": -54\n}',
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
    setSampleJson(
      '{\n  "device_id": "predio/torreA/sub1/reservatorio1",\n  "nivel_pct": 75,\n  "power_on": true,\n  "temperature": 22.5,\n  "gas_level": 300,\n  "wifi_rssi": -54\n}',
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
    });

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
          {/* Stepper */}
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

          {/* Conteúdo dos passos */}
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
                                  `widget.${wt
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
                            placeholder="e.g. °C, %"
                          />
                        </div>
                        {/* Threshold mínimo */}
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
                        {/* Threshold máximo */}
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

          {/* Navegação */}
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
                    className={`flex-1 flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${
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
