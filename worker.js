let apiKey = '';
let modelId = 'openrouter/auto';
let isInitialized = false;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const APP_REFERER = (self.location && self.location.origin) || 'http://localhost';
const APP_TITLE = 'Midari AI';

const MODEL_CONFIG = {
  temperature: 0.7,
  max_tokens: 1000,
};
function formatOpenRouterError(status, bodyText) {
  let json = null;
  try { json = JSON.parse(bodyText); } catch (_) {}
  const remoteMsg = (json && (json.error?.message || json.message)) || '';
  switch (status) {
    case 401:
      return 'API key inválida o sin permisos. Verifica tu clave de OpenRouter.';
    case 402:
      return 'Créditos insuficientes en OpenRouter. Compra créditos o usa una clave con saldo: https://openrouter.ai/settings/credits';
    case 403:
      return 'Acceso denegado por OpenRouter. Revisa permisos de tu clave o el modelo seleccionado.';
    case 404:
      return 'Recurso no encontrado. Verifica el modelo seleccionado.';
    case 429:
      return 'Has superado el límite de solicitudes (rate limit). Intenta de nuevo en unos segundos.';
    default:
      if (status >= 500) {
        return 'OpenRouter presenta un problema temporal (5xx). Intenta de nuevo más tarde.';
      }
      return `Error HTTP ${status}${remoteMsg ? `: ${remoteMsg}` : ''}`;
  }
}
async function initializeModel() {
  try {
    self.postMessage({
      type: 'status',
      message: 'Esperando API key de OpenRouter...',
      progress: 0,
    });
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: `Error al inicializar: ${error.message}`,
    });
  }
}

async function generateResponse(message, conversationHistory = []) {
  if (!isInitialized || !apiKey) {
    throw new Error('No configurado: falta API key o modelo');
  }

  try {
    const messages = [
      { role: 'system', content: 'Eres un asistente útil y amigable. Responde en español de forma clara y concisa.' },
      ...conversationHistory,
      { role: 'user', content: message },
    ];

    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': APP_REFERER,
        'X-Title': APP_TITLE,
      },
      body: JSON.stringify({
        model: modelId,
        messages,
        temperature: MODEL_CONFIG.temperature,
        max_tokens: MODEL_CONFIG.max_tokens,
        stream: true,
      }),
    });

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '');
      const friendly = formatOpenRouterError(response.status, text);
      throw new Error(friendly);
    }

    let fullResponse = '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split('\n\n');
      buffer = events.pop() || '';

      for (const evt of events) {
        const lines = evt.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') {
            self.postMessage({ type: 'response_complete', response: fullResponse });
            return;
          }
          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta?.content || json.choices?.[0]?.message?.content || '';
            if (delta) {
              fullResponse += delta;
              self.postMessage({ type: 'response_chunk', chunk: delta, fullResponse });
            }
          } catch (e) {
          }
        }
      }
    }

    self.postMessage({ type: 'response_complete', response: fullResponse });
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: `Error al generar respuesta: ${error.message}`,
    });
  }
}
self.addEventListener("message", async (event) => {
  const { type, data } = event.data;

  switch (type) {
    case "initialize":
      await initializeModel();
      break;

    case 'configure':
      try {
        apiKey = data?.apiKey || '';
        modelId = data?.model || 'openrouter/auto';
        if (!apiKey) {
          self.postMessage({ type: 'status', message: 'API key vacía. Por favor, configúrala.', progress: 0 });
          return;
        }
        isInitialized = true;
        self.postMessage({ type: 'status', message: 'Conectado a OpenRouter', progress: 100, ready: true });
        self.postMessage({ type: 'initialized' });
      } catch (e) {
        self.postMessage({ type: 'error', message: `Error al configurar: ${e.message}` });
      }
      break;

    case "generate":
      await generateResponse(data.message, data.history);
      break;

    default:
      console.warn("Tipo de mensaje desconocido:", type);
  }
});
