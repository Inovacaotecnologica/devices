import { User } from '../types';

// The Google Sheet must be published to the web as a CSV for this to work.
// Go to File -> Share -> Publish to web -> Select the sheet -> Publish as "Comma-separated values (.csv)"
const GOOGLE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1t7r1VfOFwEx55gOW9lZlqmjJSITZuyBKRNl_hVLaMzE/export?format=csv';

// Using a CORS proxy to bypass browser security restrictions on fetching from google.com
const PROXY_URL = `https://api.allorigins.win/raw?url=${encodeURIComponent(GOOGLE_SHEET_URL)}`;

/**
 * Fetches user data from the Google Sheet and parses it.
 * @returns A promise that resolves to an array of User objects with their passwords for authentication.
 * @throws An error if the fetch fails or the CSV is malformed.
 */
export const fetchUsers = async (): Promise<(User & { senha: string })[]> => {
  try {
    const response = await fetch(PROXY_URL);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    // The proxy service (allorigins.win) can be inconsistent.
    // This logic handles both raw CSV and JSON-wrapped responses.
    const responseText = await response.text();
    let csvText: string;
    
    try {
      // Attempt to parse as JSON first, in case the proxy wraps the response.
      const jsonResponse = JSON.parse(responseText);
      if (jsonResponse && typeof jsonResponse.contents === 'string') {
        csvText = jsonResponse.contents;
      } else {
        // It's JSON, but not the format we expect (e.g., an error from the proxy).
        throw new Error('Proxy returned unexpected JSON format.');
      }
    } catch (e) {
      // If JSON.parse fails, it's not a JSON response.
      // Assume the raw text is the CSV content we want.
      csvText = responseText;
    }
    
    if (!csvText) {
      throw new Error("CSV content is empty or missing in the proxy response.");
    }

    // Use regex to robustly handle both LF (\n) and CRLF (\r\n) line endings
    const lines = csvText.trim().split(/\r?\n/);
    if (lines.length === 0 || lines[0].trim() === '') {
      return []; // Return empty array if sheet is empty or has only headers
    }
    const headers = lines[0].split(',').map(h => h.trim());

    const emailIndex = headers.indexOf('email');
    const passwordIndex = headers.indexOf('senha');
    const maxCompaniesIndex = headers.indexOf('maxCompanies');
    const maxDevicesIndex = headers.indexOf('maxDevices');

    if ([emailIndex, passwordIndex, maxCompaniesIndex, maxDevicesIndex].includes(-1)) {
        console.error("CSV headers are incorrect. Expected: email,senha,maxCompanies,maxDevices. Found:", headers);
        throw new Error("Malformed CSV headers.");
    }

    // Directly parse all user data, including the password for the auth check.
    const usersWithAuthData = lines.slice(1).map(line => {
      // Skip empty lines
      if (line.trim() === '') return null;
      
      const values = line.split(',').map(v => v.trim());
      // Ensure the line has enough values to prevent errors
      if (values.length < headers.length) {
        return null;
      }
      return {
        email: values[emailIndex],
        // Note: Storing plain text passwords is a major security risk. This is for demo purposes only.
        // In a real application, passwords should be hashed.
        senha: values[passwordIndex],
        maxCompanies: parseInt(values[maxCompaniesIndex], 10) || 0,
        maxDevices: parseInt(values[maxDevicesIndex], 10) || 0,
      };
    }).filter(Boolean) as (User & { senha: string })[]; // Filter out any null entries from malformed lines

    return usersWithAuthData;

  } catch (error) {
    console.error("Failed to fetch or parse user data from Google Sheet:", error);
    // As a fallback for development if the sheet is unavailable, you can return mock data.
    // In this case, we'll re-throw to show the error on the login page.
    throw error;
  }
};