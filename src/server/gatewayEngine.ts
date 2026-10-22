import { Request, Response } from 'express';
import { appendLog, getGatewayData } from './store';
import { AIProvider, ChatMessage, ProviderModel } from '../types/gateway';

function convertOpenAiMessagesToGemini(messages: ChatMessage[]) {
  let systemInstruction: string | undefined = undefined;
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemInstruction = systemInstruction ? `${systemInstruction}\n${msg.content}` : msg.content;
    } else {
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content || '' }],
      });
    }
  }

  return {
    contents,
    systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
  };
}

function convertGeminiToOpenAiResponse(geminiData: any, modelId: string) {
  const candidate = geminiData.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text || '';
  const finishReason = candidate?.finishReason === 'STOP' ? 'stop' : (candidate?.finishReason?.toLowerCase() || 'stop');
  const promptTokens = geminiData.usageMetadata?.promptTokenCount || 0;
  const completionTokens = geminiData.usageMetadata?.candidatesTokenCount || 0;

  return {
    id: `chatcmpl-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: text,
        },
        finish_reason: finishReason,
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

export async function processChatCompletion(req: Request, res: Response) {
  const overallStart = Date.now();
  const db = await getGatewayData();

  // 1. Authenticate Master Key
  const authHeader = req.headers['authorization'] || '';
  const token = (typeof authHeader === 'string' ? authHeader : authHeader[0] || '').replace(/^Bearer\s+/i, '').trim();

  const masterKey = db.settings.masterApiKey;
  if (masterKey && token !== masterKey) {
    return res.status(401).json({
      error: {
        message: 'Invalid or missing Gateway Master Key in Authorization header',
        type: 'invalid_request_error',
        code: 'unauthorized',
      },
    });
  }

  const { model: requestedModel, messages = [], stream = false, temperature = 0.7, max_tokens = 2048 } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      error: {
        message: 'Request body must include a valid non-empty "messages" array',
        type: 'invalid_request_error',
      },
    });
  }

  // 2. Discover Candidates from Dynamic DB (Active Providers & Active Models)
  const activeProviders = Object.values(db.providers).filter((p) => p && p.enabled);
  const candidates: Array<{ provider: AIProvider; model: ProviderModel }> = [];

  for (const prov of activeProviders) {
    const activeModels = (prov.models || []).filter((m) => m && m.enabled);
    for (const mod of activeModels) {
      candidates.push({ provider: prov, model: mod });
    }
  }

  // Sort candidates by priority (1 is highest)
  candidates.sort((a, b) => (a.model.priority || 99) - (b.model.priority || 99));

  // If specific model requested, rank it first
  let executionQueue = candidates;
  if (requestedModel) {
    const directMatches = candidates.filter((c) => c.model.id === requestedModel);
    const fallbacks = candidates.filter((c) => c.model.id !== requestedModel);
    if (directMatches.length > 0) {
      executionQueue = [...directMatches, ...fallbacks];
    }
  }

  if (executionQueue.length === 0) {
    return res.status(503).json({
      error: {
        message: 'No active AI providers or models configured in the gateway.',
        type: 'gateway_error',
      },
    });
  }

  let attemptCount = 0;
  const failureDetails: Array<{ provider: string; model: string; error: string; status: number }> = [];

  // Fallback Engine loop
  for (const item of executionQueue) {
    attemptCount++;
    const { provider, model } = item;
    const isFallback = attemptCount > 1;
    const attemptStart = Date.now();
    const logId = `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    try {
      if (provider.protocol === 'gemini-native') {
        const apiKey = provider.apiKey || process.env.GEMINI_API_KEY || '';
        if (!apiKey) {
          throw new Error('Google Gemini API Key is missing');
        }

        const { contents, systemInstruction } = convertOpenAiMessagesToGemini(messages);
        const endpoint = `${provider.baseUrl.replace(/\/$/, '')}/models/${model.id}:${
          stream ? 'streamGenerateContent?alt=sse&key=' : 'generateContent?key='
        }${encodeURIComponent(apiKey)}`;

        const geminiPayload: any = {
          contents,
          generationConfig: {
            temperature,
            maxOutputTokens: max_tokens,
          },
        };
        if (systemInstruction) {
          geminiPayload.systemInstruction = systemInstruction;
        }

        const upstreamRes = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(geminiPayload),
        });

        if (!upstreamRes.ok) {
          const errText = await upstreamRes.text();
          const latency = Date.now() - attemptStart;
          failureDetails.push({
            provider: provider.name,
            model: model.id,
            error: errText.substring(0, 200),
            status: upstreamRes.status,
          });

          await appendLog({
            id: logId,
            timestamp: Date.now(),
            providerId: provider.id,
            providerName: provider.name,
            model: model.id,
            status: 'failure',
            statusCode: upstreamRes.status,
            latencyMs: latency,
            errorMessage: `Gemini Error ${upstreamRes.status}: ${errText.substring(0, 300)}`,
            wasFallback: isFallback,
            originalModelRequested: requestedModel,
            stream,
            userAgent: req.headers['user-agent'],
          });

          // Check if rate limit (429) or 5xx server error: Trigger fallback!
          if (db.settings.fallbackEnabled && (upstreamRes.status === 429 || upstreamRes.status >= 500)) {
            console.warn(`[Gateway Fallback] Provider ${provider.name} (${model.id}) failed with ${upstreamRes.status}. Retrying next in chain...`);
            continue;
          } else {
            return res.status(upstreamRes.status).json({
              error: {
                message: `Gemini Upstream Error: ${errText}`,
                code: upstreamRes.status,
              },
            });
          }
        }

        // Success handling
        if (!stream) {
          const data = await upstreamRes.json();
          const latency = Date.now() - overallStart;
          const openAiFormatted = convertGeminiToOpenAiResponse(data, model.id);

          await appendLog({
            id: logId,
            timestamp: Date.now(),
            providerId: provider.id,
            providerName: provider.name,
            model: model.id,
            status: 'success',
            statusCode: 200,
            latencyMs: latency,
            wasFallback: isFallback,
            originalModelRequested: requestedModel,
            stream: false,
            promptTokens: openAiFormatted.usage.prompt_tokens,
            completionTokens: openAiFormatted.usage.completion_tokens,
            totalTokens: openAiFormatted.usage.total_tokens,
            userAgent: req.headers['user-agent'],
          });

          return res.status(200).json(openAiFormatted);
        } else {
          // Streaming Gemini to OpenAI SSE
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');

          const completionId = `chatcmpl-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
          let totalCompletionChars = 0;

          if (!upstreamRes.body) {
            throw new Error('No streaming response body from upstream');
          }

          // Read stream chunks
          const reader = upstreamRes.body.getReader();
          const decoder = new TextDecoder();
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
                const jsonStr = trimmed.slice(6);
                if (jsonStr === '[DONE]') continue;
                try {
                  const chunkData = JSON.parse(jsonStr);
                  const chunkText = chunkData.candidates?.[0]?.content?.parts?.[0]?.text || '';
                  if (chunkText) {
                    totalCompletionChars += chunkText.length;
                    const openAiChunk = {
                      id: completionId,
                      object: 'chat.completion.chunk',
                      created: Math.floor(Date.now() / 1000),
                      model: model.id,
                      choices: [
                        {
                          index: 0,
                          delta: { content: chunkText },
                          finish_reason: null,
                        },
                      ],
                    };
                    res.write(`data: ${JSON.stringify(openAiChunk)}\n\n`);
                  }
                } catch (parseErr) {
                  // ignore non-json SSE lines
                }
              }
            }
          }

          // Send final stop chunk and [DONE]
          const finalChunk = {
            id: completionId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: model.id,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: 'stop',
              },
            ],
          };
          res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();

          const latency = Date.now() - overallStart;
          await appendLog({
            id: logId,
            timestamp: Date.now(),
            providerId: provider.id,
            providerName: provider.name,
            model: model.id,
            status: 'success',
            statusCode: 200,
            latencyMs: latency,
            wasFallback: isFallback,
            originalModelRequested: requestedModel,
            stream: true,
            completionTokens: Math.ceil(totalCompletionChars / 4),
            userAgent: req.headers['user-agent'],
          });

          return;
        }
      } else {
        // OpenAI-compatible protocol
        const targetUrl = `${provider.baseUrl.replace(/\/$/, '')}/chat/completions`;
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.apiKey}`,
          ...(provider.customHeaders || {}),
        };

        const upstreamBody = {
          ...req.body,
          model: model.id,
        };

        const upstreamRes = await fetch(targetUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(upstreamBody),
        });

        if (!upstreamRes.ok) {
          const errText = await upstreamRes.text();
          const latency = Date.now() - attemptStart;
          failureDetails.push({
            provider: provider.name,
            model: model.id,
            error: errText.substring(0, 200),
            status: upstreamRes.status,
          });

          await appendLog({
            id: logId,
            timestamp: Date.now(),
            providerId: provider.id,
            providerName: provider.name,
            model: model.id,
            status: 'failure',
            statusCode: upstreamRes.status,
            latencyMs: latency,
            errorMessage: `Upstream error ${upstreamRes.status}: ${errText.substring(0, 300)}`,
            wasFallback: isFallback,
            originalModelRequested: requestedModel,
            stream,
            userAgent: req.headers['user-agent'],
          });

          if (db.settings.fallbackEnabled && (upstreamRes.status === 429 || upstreamRes.status >= 500)) {
            console.warn(`[Gateway Fallback] Provider ${provider.name} (${model.id}) failed with ${upstreamRes.status}. Retrying next candidate...`);
            continue;
          } else {
            return res.status(upstreamRes.status).json({
              error: {
                message: `Upstream error from ${provider.name}: ${errText}`,
                code: upstreamRes.status,
              },
            });
          }
        }

        if (!stream) {
          const data = await upstreamRes.json();
          const latency = Date.now() - overallStart;

          await appendLog({
            id: logId,
            timestamp: Date.now(),
            providerId: provider.id,
            providerName: provider.name,
            model: model.id,
            status: 'success',
            statusCode: 200,
            latencyMs: latency,
            wasFallback: isFallback,
            originalModelRequested: requestedModel,
            stream: false,
            promptTokens: data.usage?.prompt_tokens,
            completionTokens: data.usage?.completion_tokens,
            totalTokens: data.usage?.total_tokens,
            userAgent: req.headers['user-agent'],
          });

          return res.status(200).json(data);
        } else {
          // Pass-through streaming SSE
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');

          if (!upstreamRes.body) throw new Error('No upstream body for stream');
          const reader = upstreamRes.body.getReader();

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
          res.end();

          const latency = Date.now() - overallStart;
          await appendLog({
            id: logId,
            timestamp: Date.now(),
            providerId: provider.id,
            providerName: provider.name,
            model: model.id,
            status: 'success',
            statusCode: 200,
            latencyMs: latency,
            wasFallback: isFallback,
            originalModelRequested: requestedModel,
            stream: true,
            userAgent: req.headers['user-agent'],
          });
          return;
        }
      }
    } catch (err: any) {
      const latency = Date.now() - attemptStart;
      failureDetails.push({
        provider: provider.name,
        model: model.id,
        error: err?.message || 'Connection failed',
        status: 500,
      });

      await appendLog({
        id: logId,
        timestamp: Date.now(),
        providerId: provider.id,
        providerName: provider.name,
        model: model.id,
        status: 'failure',
        statusCode: 500,
        latencyMs: latency,
        errorMessage: err?.message || 'Connection failure',
        wasFallback: isFallback,
        originalModelRequested: requestedModel,
        stream,
        userAgent: req.headers['user-agent'],
      });

      if (db.settings.fallbackEnabled) {
        continue;
      } else {
        return res.status(500).json({ error: { message: err?.message || 'Connection failed' } });
      }
    }
  }

  // If all fallbacks exhausted
  return res.status(502).json({
    error: {
      message: 'All available AI providers in the fallback chain were exhausted or rate-limited.',
      type: 'gateway_fallback_exhausted',
      attempts: attemptCount,
      failures: failureDetails,
    },
  });
}
