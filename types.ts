
export enum Language {
  EN = 'en',
  PT = 'pt',
  ES = 'es',
}

export interface User {
  email: string;
  maxCompanies: number;
  maxDevices: number;
}

export enum Protocol {
  HTTP = 'HTTP/HTTPS',
  MQTT = 'MQTT',
  FTP = 'FTP',
}

export enum WidgetType {
  Tank = 'Tank Level',
  Switch = 'On/Off Switch',
  Gauge = 'Gauge',
  Value = 'Simple Value',
}

export interface Widget {
  id: string;
  name: string;
  type: WidgetType;
  dataKey: string;
  unit?: string;
}

export interface Device {
  id: string;
  companyId: string;
  name: string;
  protocol: Protocol;
  protocolConfig: Record<string, string>;
  sampleJson: string;
  widgets: Widget[];
  lastData: Record<string, any>;
  lastUpdated: number;
  isOnline: boolean;
}

export interface Company {
  id: string;
  name: string;
}
   