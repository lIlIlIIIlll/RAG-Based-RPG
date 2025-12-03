// src/services/gemini.service.js
const { GoogleGenerativeAI } = require("@google/generative-ai");
const config = require("../config");

// --- Helper de Retry e Timeout ---

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = (promise, ms) => {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Operation timed out after ${ms}ms`));
    }, ms);
  });

  return Promise.race([
    promise,
    timeoutPromise
  ]).finally(() => clearTimeout(timeoutId));
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

      const isRateLimit = error.message.includes("429") || error.message.includes("Too Many Requests");
      const delay = isRateLimit ? Math.pow(2, attempt) * 2000 : 1000; // Backoff exponencial agressivo para rate limit (base 2s)

      console.warn(`[Gemini] Erro em ${operationName} (Tentativa ${attempt}/${maxRetries}): ${error.message}. Retentando em ${delay}ms...`);
      await sleep(delay);
    }
  }
}

/**
 * Obtém uma instância do cliente Gemini com a chave fornecida.
 * @param {string} apiKey 
 * @returns {GoogleGenerativeAI}
 */
function getClient(apiKey) {
  if (!apiKey) {
    throw new Error("API Key do Gemini não fornecida.");
  }
  return new GoogleGenerativeAI(apiKey);
}

/**
 * @param {string} text - O texto a ser convertido em embedding.
 * @param {string} apiKey - A chave de API a ser usada.
 * @returns {Promise<number[]>} O vetor de embedding.
 */
async function generateEmbedding(text, apiKey) {
  return retryOperation(async () => {
    try {
      const genAI = getClient(apiKey);
      const embeddingModel = genAI.getGenerativeModel({
        model: "gemini-embedding-001",
      });

      // Limita log para não poluir
      const snippet = text ? text.substring(0, 50) : "";
      // console.log(`[Gemini] Gerando embedding para: "${snippet}..."`); // Comentado para reduzir ruído em retries

      const result = await withTimeout(embeddingModel.embedContent({
        content: { parts: [{ text }] },
        outputDimensionality: config.embeddingDimension,
      }), 30000); // 30s timeout
      return result.embedding.values;
    } catch (error) {
      console.error("[Gemini] Erro ao gerar embedding:", error.message);
      throw error; // Re-throw para o retry pegar
    }
  }, "generateEmbedding");
}

/**
 * (Opcional) Gera uma query de busca textual otimizada.
 * Usa o modelo padrão leve para essa tarefa auxiliar.
 * @param {string} contextText
 * @param {string} apiKey
 */
async function generateSearchQuery(contextText, apiKey) {
  try {
    return await retryOperation(async () => {
      console.log(`[Gemini] Gerando query de busca a partir do contexto...`);

      const genAI = getClient(apiKey);
      // Usa um modelo leve para tarefas auxiliares
      const auxModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

      const prompt = config.queryGenerationPrompt.replace(
        "{context}",
        contextText
      );

      const result = await withTimeout(auxModel.generateContent(prompt), 30000); // 30s timeout
      const response = result.response;
      const query = response.text();

      const trimmedQuery = query.trim();
      console.log(`[Gemini] Query de busca gerada: "${trimmedQuery}"`);
      return trimmedQuery;
    }, "generateSearchQuery");
  } catch (error) {
    console.error("[Gemini] Erro ao gerar query de busca após retries:", error.message);
    // Retorna o próprio contexto em caso de erro (fail-safe)
    return contextText;
  }
}

/**
 * Gera uma resposta de chat com base em um histórico e uma instrução de sistema.
 * 
 * @param {object[]} history - Histórico completo formatado pra API do Gemini.
 * @param {string} systemInstruction - Instrução de sistema.
 * @param {object} generationOptions - { modelName, temperature, tools, apiKey }
 * @returns {Promise<{text: string, functionCalls: object[]}>} Objeto com texto e chamadas de função.
 */
async function generateChatResponse(history, systemInstruction, generationOptions = {}) {
  return retryOperation(async () => {
    try {
      // Define valores padrão se não forem passados
      const modelName = generationOptions.modelName || "gemini-2.5-flash";
      const temperature = generationOptions.temperature ?? 0.7;
      const tools = generationOptions.tools || [];
      const apiKey = generationOptions.apiKey;

      const genAI = getClient(apiKey);

      console.log(
        `[Gemini] Gerando resposta. Modelo: ${modelName} | Temp: ${temperature} | Msgs: ${history.length} | Tools: ${tools.length}`
      );

      // Instancia o modelo dinamicamente com as configurações deste chat
      const dynamicModel = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction,
        tools: tools,
        generationConfig: {
          temperature: temperature,
        }
      });

      if (!history || history.length === 0) {
        // fallback: sem histórico
        const result = await withTimeout(dynamicModel.generateContent(
          "Inicie a conversa com o usuário."
        ), 120000); // 120s timeout
        const response = result.response;

        let text = "";
        try { text = response.text(); } catch (e) { }
        const functionCalls = typeof response.functionCalls === 'function' ? response.functionCalls() : [];
        const parts = response.candidates?.[0]?.content?.parts || [];

        return { text, functionCalls, parts };
      }

      // Separa histórico da última mensagem (padrão da lib Google)
      const historyWithoutLast = history.slice(0, -1);
      const lastTurn = history[history.length - 1];

      const chat = dynamicModel.startChat({
        history: historyWithoutLast,
      });

      let result;
      // Se a última mensagem for do usuário e tiver texto simples, enviamos como string
      // Se for function response ou complexa, enviamos as parts
      const timeoutMs = 120000; // 120s timeout

      if (lastTurn.parts && lastTurn.parts.length > 0) {
        // Verifica se é apenas texto simples
        if (lastTurn.parts.length === 1 && lastTurn.parts[0].text) {
          result = await withTimeout(chat.sendMessage(lastTurn.parts[0].text), timeoutMs);
        } else {
          result = await withTimeout(chat.sendMessage(lastTurn.parts), timeoutMs);
        }
      } else {
        // Fallback
        result = await withTimeout(chat.sendMessage("..."), timeoutMs);
      }

      const response = result.response;

      let text = "";
      try {
        text = response.text();
      } catch (e) {
        console.log("[Gemini] Resposta sem texto (provável function call pura).");
      }

      const parts = response.candidates?.[0]?.content?.parts || [];

      // Extrai function calls manualmente para capturar thoughtSignature
      const functionCalls = parts
        .filter(part => part.functionCall)
        .map(part => {
          const fc = { ...part.functionCall };
          // Se houver thoughtSignature, anexa ao objeto da chamada para ser tratado no controller/service
          if (part.thoughtSignature) {
            fc.thoughtSignature = part.thoughtSignature;
          }
          return fc;
        });

      console.log(`[Gemini] Resposta recebida. Texto: "${text.substring(0, 50)}..." | FuncCalls: ${functionCalls ? functionCalls.length : 0}`);
      if (functionCalls && functionCalls.length > 0) {
        console.log("[Gemini] Parts structure:", JSON.stringify(parts, null, 2));
      }

      return {
        text,
        functionCalls,
        parts
      };
    } catch (error) {
      console.error("[Gemini] Erro ao gerar resposta de chat:", error.message);
      throw error;
    }
  }, "generateChatResponse");
}

/**
 * Gera uma imagem a partir de um prompt de texto.
 * @param {string} prompt - A descrição da imagem.
 * @param {string} apiKey - A chave de API a ser usada.
 * @returns {Promise<string>} A imagem em base64.
 */
async function generateImage(prompt, apiKey) {
  return retryOperation(async () => {
    try {
      console.log(`[Gemini] Gerando imagem para: "${prompt}"`);
      const genAI = getClient(apiKey);
      const imageModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash-image" });

      const result = await withTimeout(imageModel.generateContent(prompt), 60000); // 60s timeout
      const response = result.response;

      // A resposta pode conter partes com texto ou inlineData (imagem)
      // Procuramos pela parte que tem inlineData
      if (response.candidates && response.candidates[0].content.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData) {
            console.log("[Gemini] Imagem gerada com sucesso.");
            return part.inlineData.data; // Retorna a string base64
          }
        }
      }

      throw new Error("Nenhuma imagem foi retornada pelo modelo.");
    } catch (error) {
      console.error("[Gemini] Erro ao gerar imagem:", error.message);
      throw error;
    }
  }, "generateImage");
}

module.exports = {
  generateEmbedding,
  generateSearchQuery,
  generateChatResponse,
  generateImage,
};