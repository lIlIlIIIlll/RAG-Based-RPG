// src/config/index.js
require("dotenv").config();

const config = {
  port: process.env.PORT || 3001,
  geminiApiKey: process.env.GEMINI_API_KEY,
  dbPath: "data/sample-lancedb",
  embeddingDimension: 768,

  // Coleções usadas no LanceDB
  collectionNames: ["fatos", "historico", "conceitos"],

  // Limite de palavras para o histórico curto (janela de contexto)
  historyWordLimit: 30000,

  // Limite de palavras para a memória vetorial recuperada a cada turno.
  vectorMemoryWordLimit: 25000,

  /**
   * (Atualmente não usada, mas mantida para futura query generation se quiser)
   * Prompt para o Gemini gerar uma query de busca otimizada (Query Transformation).
   * A variável {context} será substituída pelo histórico da conversa.
   */
  queryGenerationPrompt: `
    Você é um especialista em recuperação de informação. Com base no histórico de conversa fornecido, 
    gere uma única query de busca, concisa e semanticamente rica, para encontrar as informações 
    mais relevantes para continuar a conversa. A query deve ser uma única frase ou sentença. 
    Não adicione explicações ou prefixos.

    Histórico da Conversa:
    ---
    {context}
    ---
  `,

  /**
   * Template para a instrução de sistema enviada ao Gemini.
   * A variável {vector_memory} será substituída pelos dados recuperados da busca vetorial.
   *
   * Importante: agora o modelo pode usar tanto o próprio conhecimento quanto a memória vetorial.
   */
  systemInstructionTemplate: `
    Você é um assistente de IA prestativo e inteligente, com amplo conhecimento geral.
    Além disso, você recebe informações contextuais recuperadas de memórias anteriores
    (histórico antigo, fatos, conceitos, anotações, etc.).

    Use essas informações recuperadas como CONTEXTO ADICIONAL quando forem relevantes,
    mas você ainda pode usar seu próprio conhecimento para responder da melhor forma possível.
    Se as informações recuperadas forem incompletas, redundantes ou irrelevantes, ignore-as.

    Nunca apenas repita frases literalmente do contexto salvo, a menos que o usuário peça isso.
    Em vez disso, sintetize, interprete e responda de forma natural.

    Informações Contextuais Recuperadas:
    ---
    {vector_memory}
    ---
  `,
};

// Validação Robusta
// A validação global da GEMINI_API_KEY foi removida pois agora cada chat possui sua própria configuração de chave.
if (!config.geminiApiKey) {
  console.warn(
    "AVISO: A variável de ambiente GEMINI_API_KEY não foi definida. O sistema funcionará, mas será necessário configurar a chave API individualmente em cada chat."
  );
}

module.exports = config;
