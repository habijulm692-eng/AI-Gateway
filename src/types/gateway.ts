export type ProviderProtocol = 'openai-compatible' | 'gemini-native';

export interface ProviderModel {
  id: string;
  name: string;
  enabled: boolean;
  priority: number; // 1 = highest
  contextWindow?: number;
  notes?: string;
}

export interface AIProvider {
  id: string;
  name: string;
  enabled: boolean;
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKey: string;
  customHeaders?: Record<string, string>;
  models: ProviderModel[];
  createdAt: number;
  updatedAt: number;
}

export interface GatewaySettings {
  masterApiKey: string;
  firebaseUrl?: string; // Firebase Realtime Database URL
  firebaseSecret?: string; // Database secret or auth token
  cacheTtlSeconds: number; // In-memory cache TTL (default: 60)
  fallbackEnabled: boolean;
  maxRetries: number;
  requestTimeoutMs: number;
}

export interface GatewayLog {
  id: string;
  timestamp: number;
  providerId: string;
  providerName: string;
  model: string;
  status: 'success' | 'failure';
  statusCode: number;
  latencyMs: number;
  errorMessage?: string;
  errorDetails?: any;
  wasFallback: boolean;
  originalModelRequested?: string;
  stream: boolean;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  userAgent?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface ChatCompletionRequest {
  model?: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
}
