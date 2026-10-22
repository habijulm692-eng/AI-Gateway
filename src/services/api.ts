import { AIProvider, GatewayLog, GatewaySettings, ProviderModel } from '../types/gateway';

export async function fetchProviders(): Promise<AIProvider[]> {
  const res = await fetch('/api/providers');
  if (!res.ok) throw new Error('Failed to fetch providers');
  return res.json();
}

export async function saveProvider(provider: AIProvider): Promise<void> {
  const res = await fetch('/api/providers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(provider),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to save provider');
  }
}

export async function deleteProvider(id: string): Promise<void> {
  const res = await fetch(`/api/providers/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete provider');
}

export async function toggleProvider(id: string): Promise<boolean> {
  const res = await fetch(`/api/providers/${id}/toggle`, { method: 'PATCH' });
  if (!res.ok) throw new Error('Failed to toggle provider');
  const data = await res.json();
  return data.enabled;
}

export async function toggleModel(providerId: string, modelId: string): Promise<boolean> {
  const res = await fetch(`/api/providers/${providerId}/models/${modelId}/toggle`, { method: 'PATCH' });
  if (!res.ok) throw new Error('Failed to toggle model');
  const data = await res.json();
  return data.enabled;
}

export async function addModel(providerId: string, model: { modelId: string; name: string; priority: number; contextWindow: number; notes: string }): Promise<void> {
  const res = await fetch(`/api/providers/${providerId}/models`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(model),
  });
  if (!res.ok) throw new Error('Failed to add model');
}

export async function deleteModel(providerId: string, modelId: string): Promise<void> {
  const res = await fetch(`/api/providers/${providerId}/models/${modelId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete model');
}

export async function updateModelPriority(providerId: string, modelId: string, priority: number): Promise<void> {
  const res = await fetch(`/api/providers/${providerId}/models/${modelId}/priority`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ priority }),
  });
  if (!res.ok) throw new Error('Failed to update priority');
}

export async function testProviderPing(id: string): Promise<{ success: boolean; latency: number; responseText?: string; error?: string }> {
  const res = await fetch(`/api/providers/${id}/test-ping`, { method: 'POST' });
  return res.json();
}

export async function fetchLogs(status = 'all', providerId = 'all', limit = 200): Promise<GatewayLog[]> {
  const params = new URLSearchParams();
  if (status !== 'all') params.set('status', status);
  if (providerId !== 'all') params.set('providerId', providerId);
  params.set('limit', limit.toString());

  const res = await fetch(`/api/logs?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch logs');
  return res.json();
}

export async function clearAllLogs(): Promise<void> {
  const res = await fetch('/api/logs', { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to clear logs');
}

export async function trigger7DayCleanup(): Promise<{ success: boolean; deletedCount: number; remainingCount: number; message: string }> {
  const res = await fetch('/api/cron/cleanup-logs', { method: 'POST' });
  return res.json();
}

export async function fetchSettings(): Promise<GatewaySettings & { hasGeminiEnvKey?: boolean }> {
  const res = await fetch('/api/settings');
  if (!res.ok) throw new Error('Failed to fetch settings');
  return res.json();
}

export async function saveSettings(settings: Partial<GatewaySettings>): Promise<void> {
  const res = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error('Failed to save settings');
}

export async function resetDefaults(): Promise<void> {
  const res = await fetch('/api/settings/reset-defaults', { method: 'POST' });
  if (!res.ok) throw new Error('Failed to reset defaults');
}

export async function testFirebaseConnection(firebaseUrl: string, firebaseSecret?: string): Promise<{ success: boolean; message?: string; error?: string }> {
  const res = await fetch('/api/firebase/test-connection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firebaseUrl, firebaseSecret }),
  });
  return res.json();
}

export async function callGatewayCompletion(payload: {
  model?: string;
  messages: Array<{ role: string; content: string }>;
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  masterApiKey: string;
  onChunk?: (text: string) => void;
}) {
  const res = await fetch('/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${payload.masterApiKey}`,
    },
    body: JSON.stringify({
      model: payload.model,
      messages: payload.messages,
      stream: payload.stream,
      temperature: payload.temperature,
      max_tokens: payload.max_tokens,
    }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData?.error?.message || `Gateway returned error ${res.status}`);
  }

  if (payload.stream && payload.onChunk) {
    if (!res.body) throw new Error('No stream body');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          const raw = trimmed.slice(6);
          if (raw === '[DONE]') continue;
          try {
            const parsed = JSON.parse(raw);
            const content = parsed.choices?.[0]?.delta?.content || '';
            if (content) {
              accumulated += content;
              payload.onChunk(accumulated);
            }
          } catch (e) {
            // ignore
          }
        }
      }
    }
    return { choices: [{ message: { content: accumulated, role: 'assistant' } }] };
  } else {
    return await res.json();
  }
}
