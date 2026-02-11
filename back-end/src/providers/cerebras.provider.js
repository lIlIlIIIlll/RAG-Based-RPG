// src/services/cerebras.service.js
// Cerebras API integration for chat generation with tool calling support.
// Uses OpenAI-compatible API format.

const config = require("../config");

// Import converters from openrouter service to reuse
const {
  convertHistoryToOpenAI,
  convertToolsToOpenAI,
} = require("./openrouter.provider");

const CEREBRAS_API_URL = "https://api.cerebras.ai/v1/chat/completions";

// Available Cerebras models
const CEREBRAS_MODELS = [
  { id: "llama3.1-8b", name: "Llama 3.1 8B", speed: "~2200 tokens/s" },
  { id: "llama-3.3-70b", name: "Llama 3.3 70B", speed: "~2100 tokens/s" },
  { id: "gpt-oss-120b", name: "GPT OSS 120B", speed: "~3000 tokens/s" },
  { id: "qwen-3-32b", name: "Qwen 3 32B", speed: "~2600 tokens/s" },
  {
    id: "zai-glm-4.6",
    name: "Z.ai GLM 4.6 (Reasoning)",
    speed: "~1000 tokens/s",
  },
  {
    id: "zai-glm-4.7",
    name: "Z.ai GLM 4.7 (Reasoning)",
    speed: "~1000 tokens/s",
  },
];

// --- Helper de Retry e Timeout ---

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = (promise, ms) => {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Operation timed out after ${ms}ms`));
    }, ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() =>
    clearTimeout(timeoutId),
  );
};

/**
 * Executa uma operação com retry exponencial.
 * @param {Function} operation - A função a ser executada.
 * @param {string} operationName - Nome da operação para logs.
 * @param {number} maxRetries - Número máximo de tentativas.
 * @returns {Promise<any>} O resultado da operação.
 */
async function retryOperation(operation, operationName, maxRetries = 5) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await operation();
    } catch (error) {
      attempt++;
      if (attempt >= maxRetries) {
        throw error;
      }

      const isRateLimit =
        error.message.includes("429") ||
        error.message.includes("Too Many Requests");
      const delay = isRateLimit ? Math.pow(2, attempt) * 2000 : 1000;

      console.warn(
        `[Cerebras] Erro em ${operationName} (Tentativa ${attempt}/${maxRetries}): ${error.message}. Retentando em ${delay}ms...`,
      );
      await sleep(delay);
    }
  }
}

/**
 * Gera uma resposta de chat usando a API da Cerebras.
 *
 * @param {object[]} history - Histórico no formato Gemini (será convertido).
 * @param {string} systemInstruction - Instrução de sistema.
 * @param {object} generationOptions - { modelName, temperature, tools, apiKey }
 * @returns {Promise<{text: string, functionCalls: object[], parts: object[]}>}
 */
async function generateChatResponse(
  history,
  systemInstruction,
  generationOptions = {},
) {
  return retryOperation(async () => {
    const modelName = generationOptions.modelName || "llama-3.3-70b";
    const temperature = generationOptions.temperature ?? 0.7;
    const geminiTools = generationOptions.tools || [];
    const apiKey = generationOptions.apiKey;

    if (!apiKey) {
      throw new Error("API Key da Cerebras não fornecida.");
    }

    console.log(
      `[Cerebras] Gerando resposta. Modelo: ${modelName} | Temp: ${temperature} | Msgs: ${history.length} | Tools: ${geminiTools.length}`,
    );

    // Converte histórico e tools para formato OpenAI
    const messages = convertHistoryToOpenAI(history);
    const tools =
      geminiTools.length > 0 ? convertToolsToOpenAI(geminiTools) : undefined;

    // Adiciona system instruction no início
    if (systemInstruction) {
      messages.unshift({ role: "system", content: systemInstruction });
    }

    // Monta o body da requisição
    const requestBody = {
      model: modelName,
      messages,
      temperature,
    };

    // Add reasoning parameters based on model type
    // GLM models: disable_reasoning=false (reasoning ON by default)
    // gpt-oss-120b: reasoning_effort controls level
    if (modelName.includes("glm")) {
      // GLM models have reasoning enabled by default, we keep it ON for RPG narration
      requestBody.disable_reasoning = false;
    } else if (modelName === "gpt-oss-120b") {
      // GPT OSS supports reasoning_effort levels: low, medium, high
      requestBody.reasoning_effort =
        generationOptions.reasoningEffort || "medium";
    }

    if (tools && tools.length > 0) {
      requestBody.tools = tools;
    }

    // Função interna para fazer a requisição
    const makeRequest = async (body) => {
      const response = await withTimeout(
        fetch(CEREBRAS_API_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }),
        120000, // 120s timeout
      );
      return response;
    };

    // Faz a requisição para a Cerebras
    let response = await makeRequest(requestBody);

    // Fallback: Se o modelo não suporta tools, refaz sem tools
    if (!response.ok) {
      const errorData = await response.text();

      // Detecta erro específico de tools não suportadas
      if (
        (response.status === 400 || response.status === 404) &&
        errorData.toLowerCase().includes("tool") &&
        requestBody.tools
      ) {
        console.warn(
          `[Cerebras] Modelo ${modelName} pode não suportar tools. Refazendo requisição sem tools...`,
        );

        // Remove tools e refaz a requisição
        delete requestBody.tools;
        response = await makeRequest(requestBody);

        if (!response.ok) {
          const retryErrorData = await response.text();
          throw new Error(
            `Cerebras API error (${response.status}): ${retryErrorData}`,
          );
        }
      } else {
        // Tenta parsear erro para extrair detalhes
        let errorDetails = {};
        try {
          errorDetails = JSON.parse(errorData);
        } catch (e) {
          // Erro não é JSON
        }

        // Cria erro estruturado para o frontend
        const error = new Error(
          `Cerebras API error (${response.status}): ${errorData}`,
        );
        error.statusCode = response.status;

        // Detecta tipos específicos de erro
        if (response.status === 429) {
          error.errorType = "rate_limit";
          error.userMessage =
            "Limite de requisições atingido. Aguarde alguns segundos e tente novamente.";
        } else if (response.status === 401 || response.status === 403) {
          error.errorType = "auth";
          error.userMessage =
            "Erro de autenticação com a Cerebras. Verifique sua API Key.";
        } else {
          error.errorType = "unknown";
          error.userMessage =
            "Erro ao gerar resposta. Tente novamente ou troque de modelo.";
        }

        throw error;
      }
    }

    const data = await response.json();

    // Processa a resposta
    const choice = data.choices?.[0];
    if (!choice) {
      throw new Error("Cerebras retornou resposta vazia.");
    }

    const message = choice.message;
    let text = message.content || "";
    let functionCalls = [];
    let parts = [];

    // Processa tool calls se houver
    if (message.tool_calls && message.tool_calls.length > 0) {
      functionCalls = message.tool_calls.map((tc) => ({
        name: tc.function.name,
        args: JSON.parse(tc.function.arguments || "{}"),
        toolUseId: tc.id, // Mantemos o ID para referência
      }));

      // Monta parts no formato Gemini para compatibilidade
      parts = message.tool_calls.map((tc) => ({
        functionCall: {
          name: tc.function.name,
          args: JSON.parse(tc.function.arguments || "{}"),
        },
      }));

      if (text) {
        parts.unshift({ text });
      }
    } else {
      parts = [{ text }];
    }

    // Log reasoning tokens if present (GLM models have reasoning enabled by default)
    const reasoning = message.reasoning || null;
    if (reasoning) {
      console.log(
        `[Cerebras] Reasoning tokens detectados (${reasoning.length} chars).`,
      );
    }

    console.log(
      `[Cerebras] Resposta recebida. Texto: "${text.substring(0, 50)}..." | FuncCalls: ${functionCalls.length}`,
    );

    return { text, functionCalls, parts, reasoning };
  }, "generateChatResponse");
}

/**
 * Retorna a lista de modelos disponíveis na Cerebras.
 * @returns {Array} Lista de modelos com id, name e speed.
 */
function getAvailableModels() {
  return CEREBRAS_MODELS;
}

module.exports = {
  generateChatResponse,
  getAvailableModels,
  CEREBRAS_MODELS,
};
