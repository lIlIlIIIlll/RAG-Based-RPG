// src/services/gemini.service.js
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");
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

      const safetySettings = [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      ];

      // Usa um modelo leve para tarefas auxiliares
      const auxModel = genAI.getGenerativeModel({
        model: "gemma-3-27b",
        safetySettings: safetySettings
      });

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
    // Retorna a última mensagem do usuário como fallback (melhor que o contexto inteiro)
    const lastUserMessage = contextText.split('\n').reverse().find(line => line.startsWith('user:'));
    return lastUserMessage ? lastUserMessage.replace('user: ', '') : contextText.substring(0, 100);
  }
}

module.exports = {
  generateEmbedding,
  generateSearchQuery,
}; 