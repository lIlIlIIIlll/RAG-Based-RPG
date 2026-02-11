// src/services/vllm.service.js
// vLLM API integration for chat generation with tool calling support.
// Uses OpenAI-compatible API format (/v1/chat/completions).

const openrouterService = require("./openrouter.provider");

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
        `[vLLM] Erro em ${operationName} (Tentativa ${attempt}/${maxRetries}): ${error.message}. Retentando em ${delay}ms...`,
      );
      await sleep(delay);
    }
  }
}

/**
 * Gera uma resposta de chat usando a API do vLLM.
 *
 * @param {object[]} history - Histórico no formato Gemini (será convertido).
 * @param {string} systemInstruction - Instrução de sistema.
 * @param {object} generationOptions - { baseUrl, apiKey, modelName, temperature, tools }
 * @returns {Promise<{text: string, functionCalls: object[], parts: object[]}>}
 */
async function generateChatResponse(
  history,
  systemInstruction,
  generationOptions = {},
) {
  return retryOperation(async () => {
    const baseUrl = generationOptions.baseUrl;
    const apiKey = generationOptions.apiKey;
    const modelName = generationOptions.modelName || "default";
    const temperature = generationOptions.temperature ?? 0.7;
    const geminiTools = generationOptions.tools || [];

    if (!baseUrl) {
      throw new Error("Base URL do vLLM não fornecida.");
    }

    if (!apiKey) {
      throw new Error("API Key do vLLM não fornecida.");
    }

    // Normaliza baseUrl (remove trailing slash e /v1 se presente)
    let normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
    // Remove /v1 do final se presente (evita duplicação)
    normalizedBaseUrl = normalizedBaseUrl.replace(/\/v1$/, "");
    const apiUrl = `${normalizedBaseUrl}/v1/chat/completions`;

    console.log(
      `[vLLM] Gerando resposta. URL: ${normalizedBaseUrl} | Modelo: ${modelName} | Temp: ${temperature} | Msgs: ${history.length} | Tools: ${geminiTools.length}`,
    );

    // Reutiliza conversões do OpenRouter (mesmo formato OpenAI)
    const messages = openrouterService.convertHistoryToOpenAI(history);
    const tools =
      geminiTools.length > 0
        ? openrouterService.convertToolsToOpenAI(geminiTools)
        : undefined;

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

    if (tools && tools.length > 0) {
      requestBody.tools = tools;
    }

    // Função interna para fazer a requisição
    const makeRequest = async (body) => {
      const response = await withTimeout(
        fetch(apiUrl, {
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

    // Faz a requisição para o vLLM
    let response = await makeRequest(requestBody);

    // Fallback: Se o modelo não suporta tools, refaz sem tools
    if (!response.ok) {
      const errorData = await response.text();

      // Detecta erros de tools não suportados
      if (
        (response.status === 400 || response.status === 404) &&
        (errorData.includes("tool") || errorData.includes("function")) &&
        requestBody.tools
      ) {
        console.warn(
          `[vLLM] Modelo ${modelName} pode não suportar tools. Refazendo requisição sem tools...`,
        );

        // Remove tools e refaz a requisição
        delete requestBody.tools;
        response = await makeRequest(requestBody);

        if (!response.ok) {
          const retryErrorData = await response.text();
          throw new Error(
            `vLLM API error (${response.status}): ${retryErrorData}`,
          );
        }
      } else {
        // Cria erro estruturado para o frontend
        const error = new Error(
          `vLLM API error (${response.status}): ${errorData}`,
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
            "Erro de autenticação com o vLLM. Verifique seu Token.";
        } else if (response.status === 404) {
          error.errorType = "not_found";
          error.userMessage =
            "Modelo ou endpoint não encontrado. Verifique a Base URL e o nome do modelo.";
        } else if (response.status >= 500) {
          error.errorType = "server_error";
          error.userMessage =
            "Erro no servidor vLLM. Verifique se o serviço está rodando corretamente.";
        } else {
          error.errorType = "unknown";
          error.userMessage =
            "Erro ao gerar resposta. Verifique as configurações do vLLM.";
        }

        throw error;
      }
    }

    const data = await response.json();

    // Processa a resposta
    const choice = data.choices?.[0];
    if (!choice) {
      throw new Error("vLLM retornou resposta vazia.");
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

    console.log(
      `[vLLM] Resposta recebida. Texto: "${text.substring(0, 50)}..." | FuncCalls: ${functionCalls.length}`,
    );

    return { text, functionCalls, parts };
  }, "generateChatResponse");
}

module.exports = {
  generateChatResponse,
};
