import { User } from '../types';

// Publicada como CSV (Arquivo > Compartilhar > Publicar na Web > CSV)
const GOOGLE_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1t7r1VfOFwEx55gOW9lZlqmjJSITZuyBKRNl_hVLaMzE/export?format=csv';

// Proxy para contornar CORS no navegador
const PROXY_URL = `https://api.allorigins.win/raw?url=${encodeURIComponent(GOOGLE_SHEET_URL)}`;

export const fetchUsers = async (): Promise<(User & { senha: string })[]> => {
  const response = await fetch(PROXY_URL);
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

  const responseText = await response.text();
  let csvText: string;

  // Tenta JSON (alguns proxies embrulham a resposta)
  try {
    const jsonResponse = JSON.parse(responseText);
    if (jsonResponse && typeof jsonResponse.contents === 'string') {
      csvText = jsonResponse.contents;
    } else {
      throw new Error('Proxy returned unexpected JSON format.');
    }
  } catch {
    // Se não for JSON, considera CSV bruto
    csvText = responseText;
  }

  if (!csvText) throw new Error('Empty CSV');

  const lines = csvText.trim().split(/\r?\n/);
  if (!lines.length || !lines[0].trim()) return [];

  const headers = lines[0].split(',').map(h => h.trim());
  const emailIndex = headers.indexOf('email');
  const passwordIndex = headers.indexOf('senha');
  const maxCompaniesIndex = headers.indexOf('maxCompanies');
  const maxDevicesIndex = headers.indexOf('maxDevices');

  if ([emailIndex, passwordIndex, maxCompaniesIndex, maxDevicesIndex].includes(-1)) {
    throw new Error('Malformed CSV headers.');
  }

  const users = lines.slice(1).map(line => {
    if (!line.trim()) return null;
    const values = line.split(',').map(v => v.trim());
    if (values.length < headers.length) return null;
    return {
      email: values[emailIndex],
      senha: values[passwordIndex],
      maxCompanies: parseInt(values[maxCompaniesIndex], 10) || 0,
      maxDevices: parseInt(values[maxDevicesIndex], 10) || 0
    };
  }).filter(Boolean) as (User & { senha: string })[];

  return users;
};
