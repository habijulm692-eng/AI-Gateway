import fs from 'fs';
import path from 'path';
import { AIProvider, GatewayLog, GatewaySettings } from '../types/gateway';

interface DatabaseData {
  settings: GatewaySettings;
  providers: Record<string, AIProvider>;
  logs: Record<string, GatewayLog>;
}

// In-Memory Cache with TTL
let inMemoryCache: DatabaseData | null = null;
let lastCacheRefresh = 0;

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'gateway-data.json');

const DEFAULT_SETTINGS: GatewaySettings = {
  masterApiKey: 'gw-sk-master-live-2026',
  firebaseUrl: '',
  firebaseSecret: '',
  cacheTtlSeconds: 60,
  fallbackEnabled: true,
  maxRetries: 3,
  requestTimeoutMs: 30000,
};

function getPreseededProviders(): Record<string, AIProvider> {
  const geminiEnvKey = process.env.GEMINI_API_KEY || '';
  const now = Date.now();

  return {
    'google-ai-studio': {
      id: 'google-ai-studio',
      name: 'Google AI Studio',
      enabled: true,
      protocol: 'gemini-native',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: geminiEnvKey,
      customHeaders: {},
      createdAt: now,
      updatedAt: now,
      models: [
        {
          id: 'gemini-2.5-flash',
          name: 'Gemini 2.5 Flash',
          enabled: true,
          priority: 1,
          contextWindow: 1048576,
          notes: 'High speed, high accuracy, multimodal default',
        },
        {
          id: 'gemini-1.5-flash',
          name: 'Gemini 1.5 Flash',
          enabled: true,
          priority: 2,
          contextWindow: 1048576,
          notes: 'Secondary ultra-reliable fast fallback',
        },
        {
          id: 'gemini-2.5-pro',
          name: 'Gemini 2.5 Pro',
          enabled: true,
          priority: 3,
          contextWindow: 2097152,
          notes: 'Frontier reasoning model for hard tasks',
        },
      ],
    },
    groq: {
      id: 'groq',
      name: 'Groq Cloud',
      enabled: true,
      protocol: 'openai-compatible',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: process.env.GROQ_API_KEY || '',
      customHeaders: {},
      createdAt: now,
      updatedAt: now,
      models: [
        {
          id: 'llama-3.3-70b-versatile',
          name: 'Llama 3.3 70B Versatile',
          enabled: true,
          priority: 1,
          contextWindow: 128000,
          notes: 'Near-instant 300+ tokens/sec inference',
        },
        {
          id: 'llama-3.1-8b-instant',
          name: 'Llama 3.1 8B Instant',
          enabled: true,
          priority: 2,
          contextWindow: 128000,
          notes: 'Ultra-lightweight fallback',
        },
      ],
    },
    openrouter: {
      id: 'openrouter',
      name: 'OpenRouter',
      enabled: true,
      protocol: 'openai-compatible',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: process.env.OPENROUTER_API_KEY || '',
      customHeaders: {
        'HTTP-Referer': 'https://gateway.ai',
        'X-Title': 'Unified AI Gateway',
      },
      createdAt: now,
      updatedAt: now,
      models: [
        {
          id: 'meta-llama/llama-3.2-3b-instruct:free',
          name: 'Llama 3.2 3B Instruct (Free)',
          enabled: true,
          priority: 1,
          contextWindow: 131072,
          notes: 'Zero-cost emergency fallback',
        },
        {
          id: 'google/gemini-2.0-flash-exp:free',
          name: 'Gemini 2.0 Flash Exp (Free)',
          enabled: true,
          priority: 2,
          contextWindow: 1048576,
          notes: 'Free-tier experimental model',
        },
      ],
    },
    xkiro: {
      id: 'xkiro',
      name: 'xKiro / Kilo',
      enabled: true,
      protocol: 'openai-compatible',
      baseUrl: 'https://api.kilo.ai/v1',
      apiKey: process.env.XKIRO_API_KEY || '',
      customHeaders: {},
      createdAt: now,
      updatedAt: now,
      models: [
        {
          id: 'kilo-deepseek-v3',
          name: 'DeepSeek V3 (Kilo)',
          enabled: true,
          priority: 1,
          contextWindow: 64000,
          notes: 'OpenAI-compatible standard gateway',
        },
        {
          id: 'kilo-llama-3.3',
          name: 'Llama 3.3 (Kilo)',
          enabled: true,
          priority: 2,
          contextWindow: 128000,
          notes: 'High throughput backup',
        },
      ],
    },
  };
}

function loadFromLocalDisk(): DatabaseData {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      return {
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
        providers: parsed.providers || getPreseededProviders(),
        logs: parsed.logs || {},
      };
    }
  } catch (err) {
    console.error('Error reading local gateway data:', err);
  }

  // Pre-seed default data
  const initialData: DatabaseData = {
    settings: DEFAULT_SETTINGS,
    providers: getPreseededProviders(),
    logs: {},
  };
  saveToLocalDisk(initialData);
  return initialData;
}

function saveToLocalDisk(data: DatabaseData) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving local gateway data:', err);
  }
}

// Firebase Realtime DB REST integration
async function fetchFromFirebase(firebaseUrl: string, secret?: string) {
  const cleanUrl = firebaseUrl.replace(/\/$/, '');
  const authQuery = secret ? `?auth=${encodeURIComponent(secret)}` : '';
  const res = await fetch(`${cleanUrl}/.json${authQuery}`, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Firebase RTDB error: ${res.status} ${res.statusText}`);
  }
  return await res.json();
}

async function writeToFirebase(firebaseUrl: string, pathSegment: string, data: any, secret?: string) {
  const cleanUrl = firebaseUrl.replace(/\/$/, '');
  const authQuery = secret ? `?auth=${encodeURIComponent(secret)}` : '';
  const url = `${cleanUrl}/${pathSegment}.json${authQuery}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    throw new Error(`Firebase RTDB write error: ${res.status}`);
  }
  return await res.json();
}

// Invalidate cache immediately on writes
export function invalidateCache() {
  inMemoryCache = null;
  lastCacheRefresh = 0;
}

export async function getGatewayData(forceRefresh = false): Promise<DatabaseData> {
  const now = Date.now();
  const cacheTtlMs = (inMemoryCache?.settings?.cacheTtlSeconds || 60) * 1000;

  if (!forceRefresh && inMemoryCache && now - lastCacheRefresh < cacheTtlMs) {
    return inMemoryCache;
  }

  // Check if Firebase URL is configured
  let data = inMemoryCache || loadFromLocalDisk();
  const firebaseUrl = data.settings.firebaseUrl || process.env.FIREBASE_DATABASE_URL;
  const firebaseSecret = data.settings.firebaseSecret || process.env.FIREBASE_DATABASE_SECRET;

  if (firebaseUrl) {
    try {
      const fbData = await fetchFromFirebase(firebaseUrl, firebaseSecret);
      if (fbData && typeof fbData === 'object') {
        data = {
          settings: { ...DEFAULT_SETTINGS, ...(fbData.settings || data.settings) },
          providers: fbData.providers || data.providers,
          logs: fbData.logs || data.logs,
        };
      }
    } catch (err) {
      console.warn('Firebase RTDB unreachable, using local store:', err);
    }
  }

  // If Gemini API key is in environment and provider has empty key, inject it
  if (process.env.GEMINI_API_KEY && data.providers['google-ai-studio'] && !data.providers['google-ai-studio'].apiKey) {
    data.providers['google-ai-studio'].apiKey = process.env.GEMINI_API_KEY;
  }

  inMemoryCache = data;
  lastCacheRefresh = now;
  return data;
}

export async function saveGatewayData(updater: (prev: DatabaseData) => DatabaseData): Promise<DatabaseData> {
  const current = await getGatewayData();
  const updated = updater(current);

  inMemoryCache = updated;
  lastCacheRefresh = Date.now();
  saveToLocalDisk(updated);

  // Sync to Firebase if configured
  const firebaseUrl = updated.settings.firebaseUrl || process.env.FIREBASE_DATABASE_URL;
  const firebaseSecret = updated.settings.firebaseSecret || process.env.FIREBASE_DATABASE_SECRET;

  if (firebaseUrl) {
    try {
      await writeToFirebase(firebaseUrl, 'settings', updated.settings, firebaseSecret);
      await writeToFirebase(firebaseUrl, 'providers', updated.providers, firebaseSecret);
    } catch (err) {
      console.error('Failed to sync settings/providers to Firebase:', err);
    }
  }

  return updated;
}

export async function appendLog(log: GatewayLog) {
  const current = await getGatewayData();
  current.logs[log.id] = log;

  // Prune logs in memory if exceeding 1000 items to avoid RAM bloat
  const logKeys = Object.keys(current.logs);
  if (logKeys.length > 1000) {
    const sorted = Object.values(current.logs).sort((a, b) => b.timestamp - a.timestamp);
    const keep = sorted.slice(0, 1000);
    const newLogs: Record<string, GatewayLog> = {};
    for (const l of keep) newLogs[l.id] = l;
    current.logs = newLogs;
  }

  saveToLocalDisk(current);

  // Async write to Firebase if connected
  const firebaseUrl = current.settings.firebaseUrl || process.env.FIREBASE_DATABASE_URL;
  const firebaseSecret = current.settings.firebaseSecret || process.env.FIREBASE_DATABASE_SECRET;

  if (firebaseUrl) {
    writeToFirebase(firebaseUrl, `logs/${log.id}`, log, firebaseSecret).catch((err) => {
      console.warn('Failed to append log to Firebase:', err);
    });
  }
}

export async function cleanupLogsOlderThan7Days() {
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - SEVEN_DAYS_MS;
  const current = await getGatewayData();

  const originalCount = Object.keys(current.logs).length;
  let deletedCount = 0;

  const retainedLogs: Record<string, GatewayLog> = {};
  for (const [key, log] of Object.entries(current.logs)) {
    if (log && log.timestamp >= cutoff) {
      retainedLogs[key] = log;
    } else {
      deletedCount++;
    }
  }

  current.logs = retainedLogs;
  saveToLocalDisk(current);

  // Sync purge to Firebase
  const firebaseUrl = current.settings.firebaseUrl || process.env.FIREBASE_DATABASE_URL;
  const firebaseSecret = current.settings.firebaseSecret || process.env.FIREBASE_DATABASE_SECRET;

  if (firebaseUrl) {
    try {
      const cleanUrl = firebaseUrl.replace(/\/$/, '');
      const authQuery = firebaseSecret ? `?auth=${encodeURIComponent(firebaseSecret)}` : '';
      await fetch(`${cleanUrl}/logs.json${authQuery}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(retainedLogs),
      });
    } catch (err) {
      console.error('Failed to cleanup logs on Firebase RTDB:', err);
    }
  }

  return {
    deletedCount,
    remainingCount: Object.keys(retainedLogs).length,
    cutoffTimestamp: cutoff,
    cutoffDateIso: new Date(cutoff).toISOString(),
  };
}

export async function resetToDefaultProviders() {
  return await saveGatewayData((prev) => ({
    ...prev,
    providers: getPreseededProviders(),
  }));
}
