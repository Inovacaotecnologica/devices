import React, { useState, useEffect, useCallback, createContext, useContext, useMemo, ReactNode } from 'react';
import { Language, User, Company, Device, Widget, Protocol, WidgetType } from './types';
import { translations, OFFLINE_THRESHOLD } from './constants';
import { fetchUsers } from './services/googleSheetService';
import { PlusIcon, BuildingOfficeIcon, WifiIcon, NoWifiIcon, TrashIcon, ChevronDownIcon, GlobeAltIcon, CodeBracketIcon } from './icons';

// =================================================================================
// CONTEXTS for State Management
// =================================================================================
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
  addDevice: (device: Omit<Device, 'id' | 'lastData' | 'lastUpdated' | 'isOnline'>) => void;
  deleteDevice: (deviceId: string) => void;
}
const DataContext = createContext<DataContextType | null>(null);
const useData = () => useContext(DataContext)!;

// =================================================================================
// PROVIDERS
// =================================================================================
const I18nProvider = ({ children }: { children: ReactNode }) => {
  const [language, setLanguage] = useState<Language>(Language.EN);
  const t = useCallback((key: string) => translations[language][key] || key, [language]);
  const value = useMemo(() => ({ language, setLanguage, t }), [language, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(() => {
    const savedUser = sessionStorage.getItem('user');
    return savedUser ? JSON.parse(savedUser) : null;
  });

  const login = async (email: string, pass: string): Promise<boolean> => {
    try {
      const usersWithPasswords = await fetchUsers();
      const matchedUser = usersWithPasswords.find(u => u.email === email && (u as any).senha === pass);
      if (matchedUser) {
        const userData: User = {
          email: matchedUser.email,
          maxCompanies: matchedUser.maxCompanies,
          maxDevices: matchedUser.maxDevices,
        };
        setUser(userData);
        sessionStorage.setItem('user', JSON.stringify(userData));
        return true;
      }
      return false;
    } catch (error) {
      console.error("Login failed:", error);
      throw error;
    }
  };

  const logout = () => {
    setUser(null);
    sessionStorage.removeItem('user');
    // Also clear data on logout
    sessionStorage.removeItem('companies');
    sessionStorage.removeItem('devices');
  };
  
  const value = useMemo(() => ({ user, login, logout }), [user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

const DataProvider = ({ children }: { children: ReactNode }) => {
  const [companies, setCompanies] = useState<Company[]>(() => {
    const saved = sessionStorage.getItem('companies');
    return saved ? JSON.parse(saved) : [];
  });
  const [devices, setDevices] = useState<Device[]>(() => {
    const saved = sessionStorage.getItem('devices');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    sessionStorage.setItem('companies', JSON.stringify(companies));
  }, [companies]);

  useEffect(() => {
    sessionStorage.setItem('devices', JSON.stringify(devices));
  }, [devices]);

  // Data fetching e status online
  useEffect(() => {
    const dataInterval = setInterval(() => {
      setDevices(currentDevices => {
        const fetchAndUpdateAll = async () => {
          if (currentDevices.length === 0) return;

          const devicePromises = currentDevices.map(async (d): Promise<Device> => {
            // Somente HTTP implementado por enquanto
            if (d.protocol === Protocol.HTTP && d.protocolConfig.url) {
              try {
                // Espera-se que d.protocolConfig.url seja um caminho do proxy, ex.: /api/devices/reservatorio1/nivel
                const url = d.protocolConfig.url;
                const response = await fetch(url, { cache: 'no-store' });
                if (!response.ok) {
                  console.error(`[Device: ${d.name}] HTTP error: ${response.status}`);
                  // Não altera lastData; apenas deixa a verificação de offline atuar
                  return d;
                }

                const newData = await response.json();
                if (typeof newData === 'object' && newData !== null && !Array.isArray(newData)) {
                  const now = Date.now();

                  // Regra de "online":
                  // - Sucesso no fetch (este bloco) marca online
                  // - Reforço por RSSI válido (<0) quando presente
                  const rssiOk = typeof newData.wifi_rssi === 'number' && newData.wifi_rssi < 0;
                  const isOnline = true || rssiOk; // sucesso no fetch já é suficiente

                  return { ...d, lastData: newData, lastUpdated: now, isOnline };
                } else {
                  console.error(`[Device: ${d.name}] Invalid JSON object received:`, newData);
                  return d;
                }
              } catch (error) {
                console.error(`[Device: ${d.name}] Failed to fetch or parse data:`, error);
                return d;
              }
            }
            // Outros protocolos permanecem inalterados
            return d;
          });

          const updatedDevices = await Promise.all(devicePromises);
          setDevices(updatedDevices);
        };
        
        fetchAndUpdateAll();
        return currentDevices; // retorno imediato; o async atualizará depois
      });
    }, 3000); // polling mais rápido

    const offlineCheckInterval = setInterval(() => {
      setDevices(prevDevices => prevDevices.map(d => {
        // Se passou do limite sem atualização, marca offline
        if (d.isOnline && Date.now() - d.lastUpdated > OFFLINE_THRESHOLD) {
          return { ...d, isOnline: false };
        }
        return d;
      }));
    }, 10000);

    return () => {
      clearInterval(dataInterval);
      clearInterval(offlineCheckInterval);
    };
  }, []);

  const addCompany = useCallback((name: string) => {
    const newCompany: Company = { id: `comp_${Date.now()}`, name };
    setCompanies(prev => [...prev, newCompany]);
  }, []);

  const addDevice = useCallback((deviceData: Omit<Device, 'id' | 'lastData' | 'lastUpdated' | 'isOnline'>) => {
    try {
      const parsedJson = JSON.parse(deviceData.sampleJson);
      const newDevice: Device = {
        ...deviceData,
        id: `dev_${Date.now()}`,
        lastData: parsedJson,
        lastUpdated: 0,
        isOnline: false,
      };
      setDevices(prev => [...prev, newDevice]);
    } catch (e) {
      console.error("Could not add device due to invalid sample JSON");
    }
  }, []);
  
  const deleteDevice = useCallback((deviceId: string) => {
    setDevices(prev => prev.filter(d => d.id !== deviceId));
  }, []);

  const value = useMemo(() => ({ companies, devices, addCompany, addDevice, deleteDevice }), [companies, devices, addCompany, addDevice, deleteDevice]);
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};


// =================================================================================
// WIDGET COMPONENTS
// =================================================================================

interface WidgetProps {
  device: Device;
  widget: Widget;
}

const TankWidget: React.FC<WidgetProps> = ({ device, widget }) => {
  const value = device.lastData[widget.dataKey] ?? 0;
  const level = Math.max(0, Math.min(100, Number(value)));
  return (
    <div className="flex flex-col items-center justify-center h-full p-4">
      <div className="w-24 h-48 border-4 border-slate-500 rounded-lg flex flex-col-reverse relative">
        <div className="bg-sky-500 rounded-b-md transition-all duration-500" style={{ height: `${level}%` }}></div>
        <div className="absolute inset-0 flex items-center justify-center text-white text-3xl font-bold">
          {level}%
        </div>
      </div>
    </div>
  );
};

const SwitchWidget: React.FC<WidgetProps> = ({ device, widget }) => {
  const isOn = device.lastData[widget.dataKey] ?? false;
  return (
    <div className="flex flex-col items-center justify-center h-full p-4 gap-4">
      <div className={`w-24 h-12 rounded-full flex items-center p-1 cursor-pointer transition-colors duration-300 ${isOn ? 'bg-green-500 justify-end' : 'bg-slate-600 justify-start'}`}>
        <div className="w-10 h-10 bg-white rounded-full shadow-lg"></div>
      </div>
      <div className={`text-2xl font-bold ${isOn ? 'text-green-400' : 'text-slate-400'}`}>{isOn ? 'ON' : 'OFF'}</div>
    </div>
  );
};

const GaugeWidget: React.FC<WidgetProps> = ({ device, widget }) => {
  const value = device.lastData[widget.dataKey] ?? 0;
  return (
    <div className="flex flex-col items-center justify-center h-full p-4">
      <div className="text-6xl font-bold text-cyan-400">{value}</div>
      <div className="text-xl text-slate-400">{widget.unit}</div>
    </div>
  );
};

const ValueWidget: React.FC<WidgetProps> = ({ device, widget }) => {
  const value = device.lastData[widget.dataKey]?.toString() ?? 'N/A';
  return (
    <div className="flex flex-col items-center justify-center h-full p-4">
      <div className="text-slate-400 text-sm">{widget.dataKey}</div>
      <div className="text-4xl font-bold text-white mt-2">{value}</div>
    </div>
  );
};

const widgetComponentMap: Record<WidgetType, React.FC<WidgetProps>> = {
  [WidgetType.Tank]: TankWidget,
  [WidgetType.Switch]: SwitchWidget,
  [WidgetType.Gauge]: GaugeWidget,
  [WidgetType.Value]: ValueWidget,
};

const DeviceCard: React.FC<{ device: Device }> = ({ device }) => {
  const { t } = useI18n();
  const { deleteDevice } = useData();
  const [isJsonModalOpen, setJsonModalOpen] = useState(false);

  return (
    <>
      <div className={`bg-slate-800 rounded-lg shadow-lg relative col-span-1 row-span-1 flex flex-col transition-opacity duration-500 ${!device.isOnline ? 'opacity-50' : ''}`}>
        <div className="p-3 border-b border-slate-700 flex justify-between items-start">
          <div>
            <h3 className="font-bold text-white">{device.name}</h3>
            <p className="text-xs text-slate-400">{device.protocol}</p>
            {device.isOnline && (
              <p className="text-xs text-slate-500 mt-1">
                {t('device.lastUpdate')}: {new Date(device.lastUpdated).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {device.isOnline ? (
              <div className="flex items-center gap-1 text-green-400 text-xs">
                <WifiIcon className="w-4 h-4" />
                <span>Online</span>
              </div>
            ) : (
              <div className="flex items-center gap-1 text-red-400 text-xs">
                <NoWifiIcon className="w-4 h-4" />
                <span>{t('device.offline')}</span>
              </div>
            )}
            <button onClick={() => setJsonModalOpen(true)} className="text-slate-500 hover:text-sky-400 transition-colors" title={t('device.viewJson')}>
              <CodeBracketIcon className="w-4 h-4" />
            </button>
            <button onClick={() => deleteDevice(device.id)} className="text-slate-500 hover:text-red-500 transition-colors">
              <TrashIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
        {device.widgets.length === 0 ? (
          <div className="flex-grow flex items-center justify-center text-slate-500">No widgets configured.</div>
        ) : (
          <div className="p-2 flex-grow grid grid-cols-2 gap-2">
            {device.widgets.map(widget => {
              const WidgetComponent = widgetComponentMap[widget.type];
              return (
                <div key={widget.id} className="bg-slate-900 rounded-md p-2 flex flex-col">
                  <h4 className="text-xs text-center text-slate-400 font-semibold mb-1 truncate">{widget.name}</h4>
                  <div className="flex-grow">
                    {WidgetComponent && <WidgetComponent device={device} widget={widget} />}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <JsonViewerModal isOpen={isJsonModalOpen} onClose={() => setJsonModalOpen(false)} data={device.lastData} />
    </>
  );
};


// =================================================================================
// MODAL COMPONENTS
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
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-slate-800 rounded-lg shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-700">
          <h2 className="text-xl font-bold">{title}</h2>
        </div>
        <div className="p-6 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
};


const AddCompanyModal: React.FC<{ isOpen: boolean, onClose: () => void }> = ({ isOpen, onClose }) => {
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
            <label htmlFor="companyName" className="block text-sm font-medium text-slate-300">{t('modal.addCompany.name')}</label>
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
            <button type="button" onClick={onClose} className="px-4 py-2 bg-slate-600 rounded-md hover:bg-slate-500 transition-colors">{t('common.cancel')}</button>
            <button type="submit" className="px-4 py-2 bg-sky-600 rounded-md hover:bg-sky-500 transition-colors">{t('common.create')}</button>
          </div>
        </form>
      ) : (
        <p className="text-red-400">{t('modal.addCompany.limit')}</p>
      )}
    </Modal>
  );
};


const AddDeviceModal: React.FC<{ isOpen: boolean, onClose: () => void, companyId: string | null }> = ({ isOpen, onClose, companyId }) => {
  const { t } = useI18n();
  const { user } = useAuth();
  const { devices, addDevice } = useData();
  const [step, setStep] = useState(1);
  
  // Step 1 state
  const [name, setName] = useState('');
  const [protocol, setProtocol] = useState<Protocol>(Protocol.HTTP);
  
  // Step 2 state
  const [protocolConfig, setProtocolConfig] = useState<Record<string, string>>({});

  // Step 3 state
  const [sampleJson, setSampleJson] = useState('{\n  "device_id": "predio/torreA/sub1/reservatorio1",\n  "nivel_pct": 75,\n  "power_on": true,\n  "temperature": 22.5,\n  "gas_level": 300,\n  "wifi_rssi": -54\n}');
  const [parsedKeys, setParsedKeys] = useState<string[]>([]);
  const [jsonError, setJsonError] = useState('');
  const [widgets, setWidgets] = useState<Omit<Widget, 'id'>[]>([]);

  useEffect(() => {
    try {
      const parsed = JSON.parse(sampleJson);
      setParsedKeys(Object.keys(parsed));
      setJsonError('');
    } catch (e) {
      setParsedKeys([]);
      setJsonError(t('modal.addDevice.parseError'));
    }
  }, [sampleJson, t]);

  const resetState = () => {
    setStep(1);
    setName('');
    setProtocol(Protocol.HTTP);
    setProtocolConfig({});
    setSampleJson('{\n  "device_id": "predio/torreA/sub1/reservatorio1",\n  "nivel_pct": 75,\n  "power_on": true,\n  "temperature": 22.5,\n  "gas_level": 300,\n  "wifi_rssi": -54\n}');
    setWidgets([]);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleSubmit = () => {
    if (!companyId) return;
    // Dica: para HTTP, informe aqui um caminho do proxy, por ex.: /api/devices/reservatorio1/nivel
    addDevice({ companyId, name, protocol, protocolConfig, sampleJson, widgets: widgets.map(w => ({...w, id: `widget_${Date.now()}_${Math.random()}`})) });
    handleClose();
  };

  const canAddDevice = user && devices.length < user.maxDevices;

  const renderProtocolFields = () => {
    switch (protocol) {
      case Protocol.HTTP:
        return (
          <div>
            <label className="block text-sm font-medium text-slate-300">{t('modal.addDevice.http.url')}</label>
            <input
              type="text"
              value={protocolConfig.url || ''}
              onChange={e => setProtocolConfig({url: e.target.value})}
              placeholder="/api/devices/reservatorio1/nivel"
              className="mt-1 block w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3"
            />
          </div>
        );
      case Protocol.MQTT:
        return (
          <>
            <div>
              <label className="block text-sm font-medium text-slate-300">{t('modal.addDevice.mqtt.broker')}</label>
              <input type="text" value={protocolConfig.broker || ''} onChange={e => setProtocolConfig(p => ({...p, broker: e.target.value}))} className="mt-1 block w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300">{t('modal.addDevice.mqtt.topic')}</label>
              <input type="text" value={protocolConfig.topic || ''} onChange={e => setProtocolConfig(p => ({...p, topic: e.target.value}))} className="mt-1 block w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3" />
            </div>
          </>
        );
      case Protocol.FTP:
        return (
          <>
            <div>
              <label className="block text-sm font-medium text-slate-300">{t('modal.addDevice.ftp.server')}</label>
              <input type="text" value={protocolConfig.server || ''} onChange={e => setProtocolConfig(p => ({...p, server: e.target.value}))} className="mt-1 block w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300">{t('modal.addDevice.ftp.path')}</label>
              <input type="text" value={protocolConfig.path || ''} onChange={e => setProtocolConfig(p => ({...p, path: e.target.value}))} className="mt-1 block w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3" />
            </div>
          </>
        );
      default:
        return null;
    }
  };
  
  const handleAddWidget = () => {
    setWidgets([...widgets, { name: 'New Widget', type: WidgetType.Value, dataKey: '' }]);
  };
  
  const handleWidgetChange = <T,>(index: number, field: keyof Omit<Widget, 'id'>, value: T) => {
    const newWidgets = [...widgets];
    (newWidgets[index] as any)[field] = value;
    setWidgets(newWidgets);
  };

  const handleDeleteWidget = (index: number) => {
    setWidgets(widgets.filter((_, i) => i !== index));
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={t('modal.addDevice.title')}>
      {!canAddDevice ? (<p className="text-red-400">{t('modal.addDevice.limit')}</p>) : (
        <div className="space-y-4">
          {/* Stepper */}
          <div className="flex justify-between items-center mb-6">
            <div className={`text-center ${step >= 1 ? 'text-sky-400' : 'text-slate-500'}`}>
              <div className={`w-8 h-8 mx-auto rounded-full border-2 flex items-center justify-center ${step >= 1 ? 'border-sky-400' : 'border-slate-500'}`}>1</div>
              <p className="text-xs mt-1">{t('modal.addDevice.step1')}</p>
            </div>
            <div className={`flex-grow h-px ${step >= 2 ? 'bg-sky-400' : 'bg-slate-500'}`}></div>
            <div className={`text-center ${step >= 2 ? 'text-sky-400' : 'text-slate-500'}`}>
              <div className={`w-8 h-8 mx-auto rounded-full border-2 flex items-center justify-center ${step >= 2 ? 'border-sky-400' : 'border-slate-500'}`}>2</div>
              <p className="text-xs mt-1">{t('modal.addDevice.step2')}</p>
            </div>
            <div className={`flex-grow h-px ${step >= 3 ? 'bg-sky-400' : 'bg-slate-500'}`}></div>
            <div className={`text-center ${step >= 3 ? 'text-sky-400' : 'text-slate-500'}`}>
              <div className={`w-8 h-8 mx-auto rounded-full border-2 flex items-center justify-center ${step >= 3 ? 'border-sky-400' : 'border-slate-500'}`}>3</div>
              <p className="text-xs mt-1">{t('modal.addDevice.step3')}</p>
            </div>
          </div>

          {/* Step Content */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300">{t('modal.addDevice.name')}</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} className="mt-1 block w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300">{t('modal.addDevice.protocol')}</label>
                <select value={protocol} onChange={e => setProtocol(e.target.value as Protocol)} className="mt-1 block w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3">
                  {Object.values(Protocol).map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="space-y-4">
              {renderProtocolFields()}
            </div>
          )}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300">{t('modal.addDevice.sampleJson')}</label>
                <textarea value={sampleJson} onChange={e => setSampleJson(e.target.value)} rows={8} className="font-mono mt-1 block w-full bg-slate-900 border border-slate-600 rounded-md py-2 px-3 text-sm"></textarea>
                {jsonError && <p className="text-red-400 text-xs mt-1">{jsonError}</p>}
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-2">{t('modal.addDevice.widgets')}</h3>
                <div className="space-y-3 max-h-60 overflow-y-auto pr-2">
                  {widgets.map((w, i) => (
                    <div key={i} className="bg-slate-700 p-3 rounded-md space-y-2 relative">
                      <button onClick={() => handleDeleteWidget(i)} className="absolute top-2 right-2 text-slate-400 hover:text-red-500">
                        <TrashIcon className="w-4 h-4" />
                      </button>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs">{t('modal.addDevice.widget.name')}</label>
                          <input type="text" value={w.name} onChange={e => handleWidgetChange(i, 'name', e.target.value)} className="w-full bg-slate-600 border-slate-500 rounded text-sm p-1" />
                        </div>
                        <div>
                          <label className="text-xs">{t('modal.addDevice.widget.type')}</label>
                          <select value={w.type} onChange={e => handleWidgetChange(i, 'type', e.target.value)} className="w-full bg-slate-600 border-slate-500 rounded text-sm p-1">
                            {Object.values(WidgetType).map(wt => <option key={wt} value={wt}>{t(`widget.${wt.toLowerCase().replace(' ','')}`)}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs">{t('modal.addDevice.widget.dataKey')}</label>
                          <select value={w.dataKey} onChange={e => handleWidgetChange(i, 'dataKey', e.target.value)} className="w-full bg-slate-600 border-slate-500 rounded text-sm p-1" disabled={parsedKeys.length === 0}>
                            <option value="">Select a key</option>
                            {parsedKeys.length > 0 ? parsedKeys.map(k => <option key={k} value={k}>{k}</option>) : <option disabled>{t('modal.addDevice.widget.noKeys')}</option>}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs">{t('modal.addDevice.widget.unit')}</label>
                          <input type="text" value={w.unit || ''} onChange={e => handleWidgetChange(i, 'unit', e.target.value)} className="w-full bg-slate-600 border-slate-500 rounded text-sm p-1" placeholder="e.g. °C, %" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <button onClick={handleAddWidget} className="mt-2 w-full text-sm py-2 bg-slate-600 hover:bg-slate-500 rounded-md transition-colors">{t('modal.addDevice.addWidget')}</button>
              </div>
            </div>
          )}
          
          {/* Navigation */}
          <div className="flex justify-between mt-6">
            <button onClick={() => setStep(s => s - 1)} disabled={step === 1} className="px-4 py-2 bg-slate-600 rounded-md hover:bg-slate-500 disabled:opacity-50 disabled:cursor-not-allowed">{t('common.back')}</button>
            {step < 3 && <button onClick={() => setStep(s => s + 1)} className="px-4 py-2 bg-sky-600 rounded-md hover:bg-sky-500">{t('common.next')}</button>}
            {step === 3 && <button onClick={handleSubmit} className="px-4 py-2 bg-green-600 rounded-md hover:bg-green-500">{t('common.finish')}</button>}
          </div>
        </div>
      )}
    </Modal>
  );
};

const JsonViewerModal: React.FC<{ isOpen: boolean, onClose: () => void, data: object }> = ({ isOpen, onClose, data }) => {
  const { t } = useI18n();
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('modal.jsonViewer.title')}>
      <div className="bg-slate-900 p-4 rounded-md max-h-[60vh] overflow-y-auto">
        <pre className="text-sm text-green-300 whitespace-pre-wrap break-all">
          <code>{JSON.stringify(data, null, 2)}</code>
        </pre>
      </div>
      <div className="flex justify-end mt-4">
        <button type="button" onClick={onClose} className="px-4 py-2 bg-slate-600 rounded-md hover:bg-slate-500 transition-colors">{t('common.close')}</button>
      </div>
    </Modal>
  );
};


// =================================================================================
// LAYOUT & PAGE COMPONENTS
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
          <button onClick={() => setDropdownOpen(!dropdownOpen)} className="flex items-center gap-2 text-slate-300 hover:text-white">
            <GlobeAltIcon className="w-5 h-5" />
            <span>{language.toUpperCase()}</span>
            <ChevronDownIcon className="w-4 h-4" />
          </button>
          {dropdownOpen && (
            <div className="absolute right-0 mt-2 w-32 bg-slate-700 rounded-md shadow-lg py-1">
              {Object.values(Language).map(lang => (
                <a href="#" key={lang} onClick={(e) => { e.preventDefault(); setLanguage(lang); setDropdownOpen(false); }} className="block px-4 py-2 text-sm text-slate-200 hover:bg-slate-600">{lang.toUpperCase()}</a>
              ))}
            </div>
          )}
        </div>
        {user && (
          <>
            <span className="text-sm text-slate-400">{user.email}</span>
            <button onClick={logout} className="px-3 py-1 bg-red-600 text-white rounded-md text-sm hover:bg-red-500 transition-colors">{t('header.logout')}</button>
          </>
        )}
      </div>
    </header>
  );
};


const Sidebar: React.FC<{ selectedCompany: string | null, setSelectedCompany: (id: string) => void }> = ({ selectedCompany, setSelectedCompany }) => {
  const { t } = useI18n();
  const { user } = useAuth();
  const { companies, devices } = useData();
  const [isCompanyModalOpen, setCompanyModalOpen] = useState(false);

  return (
    <>
      <aside className="bg-slate-800 w-64 p-4 flex flex-col">
        <h2 className="text-lg font-semibold mb-4">{t('sidebar.companies')} ({companies.length}/{user?.maxCompanies})</h2>
        <nav className="flex-grow overflow-y-auto">
          <ul>
            {companies.map(company => (
              <li key={company.id}>
                <a href="#" onClick={(e) => { e.preventDefault(); setSelectedCompany(company.id); }}
                   className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${selectedCompany === company.id ? 'bg-sky-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}>
                  <BuildingOfficeIcon className="w-5 h-5" />
                  <span>{company.name}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-4 pt-4 border-t border-slate-700">
          <button onClick={() => setCompanyModalOpen(true)} className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-green-600 text-white rounded-md hover:bg-green-500 transition-colors">
            <PlusIcon className="w-5 h-5" />
            <span>{t('sidebar.addCompany')}</span>
          </button>
          <div className="text-center text-xs text-slate-400 mt-4">
            {t('sidebar.deviceCount')}: {devices.length}/{user?.maxDevices}
          </div>
        </div>
      </aside>
      <AddCompanyModal isOpen={isCompanyModalOpen} onClose={() => setCompanyModalOpen(false)} />
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
    return devices.filter(d => d.companyId === selectedCompany);
  }, [devices, selectedCompany]);
  
  return (
    <div className="h-screen w-screen flex flex-col bg-slate-900">
      <Header />
      <div className="flex flex-grow overflow-hidden">
        <Sidebar selectedCompany={selectedCompany} setSelectedCompany={setSelectedCompany} />
        <main className="flex-grow p-6 overflow-y-auto">
          {selectedCompany ? (
            <div>
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">{t('dashboard.devices')}</h2>
                <button onClick={() => setDeviceModalOpen(true)} className="flex items-center gap-2 px-4 py-2 bg-sky-600 text-white rounded-md hover:bg-sky-500 transition-colors">
                  <PlusIcon className="w-5 h-5" />
                  {t('dashboard.addDevice')}
                </button>
              </div>
              {devicesForCompany.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {devicesForCompany.map(device => (
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
      <AddDeviceModal isOpen={isDeviceModalOpen} onClose={() => setDeviceModalOpen(false)} companyId={selectedCompany} />
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
    } catch (err) {
      setError(t('login.fetchError'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900">
      <div className="max-w-md w-full bg-slate-800 p-8 rounded-lg shadow-lg">
        <h2 className="text-3xl font-bold text-center text-white mb-6">{t('login.title')}</h2>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-300">{t('login.email')}</label>
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
            <label htmlFor="password" className="block text-sm font-medium text-slate-300">{t('login.password')}</label>
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
// MAIN APP COMPONENT
// =================================================================================
export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </I18nProvider>
  );
}

// Separate component to access Auth context within the provider tree
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
