// src/services/cli2api.service.js
// CLI2API Proxy integration for chat generation with tool calling support.
// This service communicates with a local CLI2API proxy running at localhost:8317

const {
  convertHistoryToOpenAI,
  convertToolsToOpenAI,
} = require("./openrouter.provider");

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
async function retryOperation(operation, operationName, maxRetries = 3) {
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
        `[CLI2API] Erro em ${operationName} (Tentativa ${attempt}/${maxRetries}): ${error.message}. Retentando em ${delay}ms...`,
      );
      await sleep(delay);
    }
  }
}

/**
 * Gera uma resposta de chat usando a API do CLI2API (OpenAI-compatible).
 *
 * @param {object[]} history - Histórico no formato Gemini (será convertido).
 * @param {string} systemInstruction - Instrução de sistema.
 * @param {object} generationOptions - { modelName, temperature, tools, apiKey, baseUrl }
 * @returns {Promise<{text: string, functionCalls: object[], parts: object[]}>}
 */
async function generateChatResponse(
  history,
  systemInstruction,
  generationOptions = {},
) {
  return retryOperation(async () => {
    const modelName = generationOptions.modelName || "gemini-2.5-pro";
    const temperature = generationOptions.temperature ?? 0.7;
    const geminiTools = generationOptions.tools || [];
    const apiKey = generationOptions.apiKey || "batata";
    const baseUrl = generationOptions.baseUrl || "http://localhost:8317";

    const apiUrl = `${baseUrl}/v1/chat/completions`;

    console.log(
      `[CLI2API] Gerando resposta. URL: ${apiUrl} | Modelo: ${modelName} | Temp: ${temperature} | Msgs: ${history.length} | Tools: ${geminiTools.length}`,
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

    // Faz a requisição para o CLI2API
    let response = await makeRequest(requestBody);

    // Fallback: Se o modelo não suporta tools, refaz sem tools
    if (!response.ok) {
      const errorData = await response.text();

      // Detecta erro específico de "no endpoints support tool use"
      if (
        response.status === 404 &&
        errorData.includes("No endpoints found that support tool use") &&
        requestBody.tools
      ) {
        console.warn(
          `[CLI2API] Modelo ${modelName} não suporta tools. Refazendo requisição sem tools...`,
        );

        // Remove tools e refaz a requisição
        delete requestBody.tools;
        response = await makeRequest(requestBody);

        if (!response.ok) {
          const retryErrorData = await response.text();
          throw new Error(
            `CLI2API error (${response.status}): ${retryErrorData}`,
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
          `CLI2API error (${response.status}): ${errorData}`,
        );
        error.statusCode = response.status;

        // Detecta tipos específicos de erro
        if (response.status === 403 && errorDetails.error?.metadata?.reasons) {
          error.errorType = "moderation";
          error.reasons = errorDetails.error.metadata.reasons;
          error.userMessage = `Conteúdo bloqueado pela moderação: ${error.reasons.join(", ")}. Tente reformular sua mensagem ou usar outro modelo.`;
        } else if (response.status === 429) {
          error.errorType = "rate_limit";
          error.userMessage =
            "Limite de requisições atingido. Aguarde alguns segundos e tente novamente.";
        } else if (response.status === 401 || response.status === 403) {
          error.errorType = "auth";
          error.userMessage =
            "Erro de autenticação com o CLI2API. Verifique sua API Key.";
        } else if (response.status === 502 || response.status === 503) {
          error.errorType = "proxy_error";
          error.userMessage =
            "CLI2API indisponível. Verifique se o proxy está rodando.";
        } else {
          error.errorType = "unknown";
          error.userMessage =
            "Erro ao gerar resposta. Tente novamente ou verifique o CLI2API.";
        }

        throw error;
      }
    }

    const data = await response.json();

    // Processa a resposta
    const choice = data.choices?.[0];
    if (!choice) {
      throw new Error("CLI2API retornou resposta vazia.");
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
      `[CLI2API] Resposta recebida. Texto: "${text.substring(0, 50)}..." | FuncCalls: ${functionCalls.length}`,
    );

    return { text, functionCalls, parts };
  }, "generateChatResponse");
}

/**
 * Gera uma query otimizada para busca vetorial usando Gemini 3 Pro.
 * Esta função analisa o histórico completo + memórias anteriores e gera uma query
 * que maximize a recuperação de informações úteis para a resposta atual.
 *
 * @param {string} historyText - Histórico da conversa formatado como texto.
 * @param {string} previousMemories - Memórias recuperadas na busca anterior (pode ser vazio).
 * @param {object} options - { baseUrl, apiKey }
 * @returns {Promise<string>} Query otimizada para busca vetorial.
 */
async function generateSearchQuery(
  historyText,
  previousMemories = "",
  options = {},
) {
  const baseUrl = options.baseUrl || "http://localhost:8317";
  const apiKey = options.apiKey || "batata";
  const apiUrl = `${baseUrl}/v1/chat/completions`;

  const prompt = `### SUA FUNÇÃO ###
Você é um especialista em Information Retrieval para sistemas RAG (Retrieval-Augmented Generation).
Sua tarefa é gerar uma QUERY DE BUSCA VETORIAL otimizada que será usada para recuperar memórias relevantes de um banco de dados de RPG.

### CONTEXTO TÉCNICO ###
- Suas queries serão convertidas em embeddings e comparadas via similaridade de cosseno
- O banco contém 3 coleções: FATOS (eventos concretos, inventário, NPCs), CONCEITOS (lore, magia, cultura), HISTÓRICO (mensagens anteriores)
- Embeddings capturam SEMÂNTICA, não keywords exatas - use linguagem natural e sinônimos
- Queries muito longas diluem a relevância; queries muito curtas perdem contexto

### HISTÓRICO DA CONVERSA ###
${historyText}

${
  previousMemories
    ? `### MEMÓRIAS JÁ RECUPERADAS (da busca anterior) ###
${previousMemories}

`
    : ""
}### SUA TAREFA ###
Analise o histórico e gere UMA ÚNICA query de busca que:
1. **FOQUE** na ação/pergunta mais recente do jogador
2. **IDENTIFIQUE** quais informações o Mestre precisa para responder adequadamente
3. **INCLUA** elementos que conectem a cena atual com eventos passados relevantes
4. **ANTECIPE** informações úteis para possíveis desdobramentos da cena
5. **EVITE** repetir informações que já estão nas memórias recuperadas anteriormente

### FORMATO DE SAÍDA ###
Responda APENAS com a query, sem explicações ou formatação.
Use linguagem natural, como se estivesse fazendo uma pergunta ao banco de dados.
Tamanho ideal: 50-150 palavras.

### EXEMPLO DE QUERY ###
"Informações sobre a taverna Dragão Adormecido e seu dono Bartolomeu, incluindo eventos passados que aconteceram neste local, NPCs que frequentam o estabelecimento, rumores ouvidos aqui anteriormente, e qualquer conexão com a guilda de ladrões mencionada pelo jogador. Contexto sobre o sistema monetário local e preços típicos de bebidas e quartos."`;

  try {
    console.log(`[CLI2API] Gerando query de busca com Gemini 3 Pro...`);

    const response = await withTimeout(
      fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gemini-3-pro-high",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.3, // Baixa temperatura para queries consistentes
          max_tokens: 500,
        }),
      }),
      30000, // 30s timeout
    );

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`CLI2API error (${response.status}): ${errorData}`);
    }

    const data = await response.json();
    const query = data.choices?.[0]?.message?.content?.trim() || "";

    if (!query) {
      throw new Error("CLI2API retornou query vazia.");
    }

    console.log(`[CLI2API] ═══ QUERY DE BUSCA GERADA ═══`);
    console.log(
      `  "${query.substring(0, 200)}${query.length > 200 ? "..." : ""}"`,
    );
    console.log(`  (${query.length} chars)`);

    return query;
  } catch (error) {
    console.error(`[CLI2API] Erro ao gerar query de busca: ${error.message}`);

    // Fallback: usa as últimas mensagens do histórico como query
    const lines = historyText.split("\n").filter((l) => l.trim());
    const fallbackQuery = lines.slice(-6).join(" ").substring(0, 500);
    console.warn(`[CLI2API] Usando fallback: últimas mensagens como query.`);

    return fallbackQuery;
  }
}

/**
 * Gera um contexto sintetizado a partir de memórias brutas + histórico recente.
 * Two-stage RAG: transforma fragmentos de memória em um briefing coeso para o Mestre.
 *
 * @param {string} historyText - Histórico recente da conversa.
 * @param {string} memoriesText - Memórias brutas recuperadas do RAG.
 * @param {object} options - { baseUrl, apiKey }
 * @returns {Promise<string>} Contexto sintetizado.
 */
async function generateContextSummary(historyText, memoriesText, options = {}) {
  const baseUrl = options.baseUrl || "http://localhost:8317";
  const apiKey = options.apiKey || "batata";
  const apiUrl = `${baseUrl}/v1/chat/completions`;

  const prompt = `### SUA FUNÇÃO ###
Você é um assistente de memória para um Mestre de RPG. Sua tarefa é analisar memórias recuperadas de um banco de dados e criar um BRIEFING CONTEXTUALIZADO que o Mestre usará para narrar a cena atual.

### HISTÓRICO RECENTE DA CONVERSA ###
${historyText}

### MEMÓRIAS RECUPERADAS (BRUTAS) ###
${memoriesText}

### SUA TAREFA ###
Crie um texto explicativo e coeso que:
1. **CONECTE** as memórias relevantes ao contexto atual da cena
2. **DESTAQUE** informações que o Mestre PRECISA saber agora (NPCs envolvidos, eventos passados relevantes, lore aplicável)
3. **OMITA** memórias que não têm relação com a situação atual
4. **SINTETIZE** informações redundantes em uma única menção
5. **PRIORIZE** fatos sobre o estado atual das coisas (quem está vivo/morto, relações atuais, inventário)

### FORMATO DE SAÍDA ###
Escreva em parágrafos corridos, como um briefing para o Mestre. Use negrito para nomes de NPCs e locais importantes.
NÃO use listas ou bullet points.
NÃO repita informações do histórico recente (o Mestre já sabe o que acabou de acontecer).
NÃO invente informações - use APENAS o que está nas memórias recuperadas.
NÃO descreva a carga emocional de nada.
NÃO guie o mestre para uma decisão.

O trabalho do seu briefing é PURAMENTE INFORMACIONAL, você apenas explica o contexto para que o mestre possa tomar suas próprias decisões.`;

  try {
    console.log(`[CLI2API] Gerando síntese de contexto com Gemini 3 Pro...`);

    const response = await withTimeout(
      fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gemini-3-pro-high",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.3,
          max_tokens: 2000,
        }),
      }),
      45000, // 45s timeout
    );

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`CLI2API error (${response.status}): ${errorData}`);
    }

    const data = await response.json();
    const synthesis = data.choices?.[0]?.message?.content?.trim() || "";

    if (!synthesis) {
      throw new Error("CLI2API retornou síntese vazia.");
    }

    console.log(`[CLI2API] ═══ CONTEXTO SINTETIZADO ═══`);
    console.log(
      `  ${synthesis.substring(0, 300)}${synthesis.length > 300 ? "..." : ""}`,
    );
    console.log(`  (${synthesis.length} chars)`);

    return synthesis;
  } catch (error) {
    console.error(
      `[CLI2API] Erro ao gerar síntese de contexto: ${error.message}`,
    );
    // Fallback: retorna memórias brutas
    console.warn(`[CLI2API] Usando fallback: memórias brutas.`);
    return memoriesText;
  }
}

/**
 * Gera um resumo de uma sessão que foi encerrada.
 * Usado para criar "super-fatos" que resumem o que aconteceu em sessões antigas.
 *
 * @param {string} sessionMessages - Todas as mensagens da sessão formatadas.
 * @param {string} sessionId - ID da sessão sendo resumida.
 * @param {object} options - { baseUrl, apiKey }
 * @returns {Promise<string>} Resumo da sessão.
 */
async function generateSessionSummary(
  sessionMessages,
  sessionId,
  options = {},
) {
  const baseUrl = options.baseUrl || "http://localhost:8317";
  const apiKey = options.apiKey || "batata";
  const apiUrl = `${baseUrl}/v1/chat/completions`;

  const prompt = `### SUA FUNÇÃO ###
Você é um arquivista de campanhas de RPG. Sua tarefa é criar um RESUMO EXECUTIVO de uma sessão de jogo que acabou de ser encerrada.

### SESSÃO: ${sessionId} ###
${sessionMessages}

### SUA TAREFA ###
Crie um resumo conciso que capture:
1. **EVENTOS PRINCIPAIS** - O que aconteceu de importante?
2. **DESCOBERTAS** - Que segredos ou informações foram revelados?
3. **MUDANÇAS DE ESTADO** - Quem morreu? Quem se aliou? O que mudou no mundo?
4. **THREADS ABERTAS** - Que missões ou conflitos ficaram pendentes?

### FORMATO DE SAÍDA ###
Escreva um parágrafo de 100-200 palavras, objetivo e factual.
Use formato: "${sessionId} (Dias X-Y): [resumo]"
NÃO inclua detalhes triviais ou conversas sem consequência.
FOQUE em informações que serão úteis para lembrar em sessões futuras.`;

  try {
    console.log(
      `[CLI2API] Gerando resumo da sessão ${sessionId} com Gemini 3 Pro...`,
    );

    const response = await withTimeout(
      fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gemini-3-pro-high",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
          max_tokens: 500,
        }),
      }),
      30000,
    );

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`CLI2API error (${response.status}): ${errorData}`);
    }

    const data = await response.json();
    const summary = data.choices?.[0]?.message?.content?.trim() || "";

    if (!summary) {
      throw new Error("CLI2API retornou resumo vazio.");
    }

    console.log(`[CLI2API] ═══ RESUMO DA SESSÃO ${sessionId} ═══`);
    console.log(`  ${summary}`);

    return summary;
  } catch (error) {
    console.error(`[CLI2API] Erro ao gerar resumo da sessão: ${error.message}`);
    return `${sessionId}: Resumo não disponível (erro na geração).`;
  }
}

/**
 * Gera um resumo "Previously On" das mensagens anteriores da sessão atual
 * que não estão na janela de contexto imediato (15 mensagens).
 *
 * @param {string} messagesText - Mensagens do início da sessão até (n-15).
 * @param {object} options - { baseUrl, apiKey }
 * @returns {Promise<string>} Resumo "Previously On".
 */
async function generatePreviouslyOnSummary(messagesText, options = {}) {
  const baseUrl = options.baseUrl || "http://localhost:8317";
  const apiKey = options.apiKey || "batata";
  const apiUrl = `${baseUrl}/v1/chat/completions`;

  const prompt = `### SUA FUNÇÃO ###
Você é um narrador de "previously on" para uma série de RPG. Crie um resumo rápido do que aconteceu ANTES do momento atual.

### MENSAGENS ANTERIORES ###
${messagesText}

### SUA TAREFA ###
Escreva um resumo em terceira pessoa, estilo "Previously on [série]":
- **FOQUE** nos eventos, decisões e consequências mais importantes
- **MANTENHA** a ordem cronológica dos acontecimentos
- **USE** tempo passado (aconteceu, descobriu, enfrentou)
- **LIMITE** a 100-150 palavras

### FORMATO DE SAÍDA ###
Um ou dois parágrafos corridos, sem bullet points ou listas.
Comece diretamente com os eventos, sem introdução.`;

  try {
    console.log(`[CLI2API] Gerando resumo "Previously On" com Gemini 3 Pro...`);

    const response = await withTimeout(
      fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gemini-3-pro-high",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.4,
          max_tokens: 400,
        }),
      }),
      30000,
    );

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`CLI2API error (${response.status}): ${errorData}`);
    }

    const data = await response.json();
    const summary = data.choices?.[0]?.message?.content?.trim() || "";

    if (!summary) {
      throw new Error("CLI2API retornou resumo vazio.");
    }

    console.log(`[CLI2API] ═══ PREVIOUSLY ON ═══`);
    console.log(
      `  ${summary.substring(0, 200)}${summary.length > 200 ? "..." : ""}`,
    );

    return summary;
  } catch (error) {
    console.error(`[CLI2API] Erro ao gerar Previously On: ${error.message}`);
    return ""; // Retorna vazio para não bloquear o fluxo
  }
}

module.exports = {
  generateChatResponse,
  generateSearchQuery,
  generateContextSummary,
  generateSessionSummary,
  generatePreviouslyOnSummary,
};
