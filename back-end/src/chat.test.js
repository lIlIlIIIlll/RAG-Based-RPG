// test_chat_edit.js
const axios = require("axios");

// URL base da sua API.
const BASE_URL = "http://localhost:3001/api/chat";

/**
 * Função auxiliar para imprimir seções do log de forma bonita.
 * @param {string} title
 */
function printSection(title) {
  console.log("\n" + "=".repeat(60));
  console.log(` ✅ ${title}`);
  console.log("=".repeat(60));
}

/**
 * NOVO: Função para contar palavras, usada para o relatório.
 * @param {string | object[]} data - String ou array de objetos com a propriedade 'text'.
 * @returns {number}
 */
function countWords(data) {
  if (!data) return 0;
  if (typeof data === "string") {
    return data.trim().split(/\s+/).length;
  }
  if (Array.isArray(data)) {
    return data.reduce((acc, item) => acc + (item.text ? countWords(item.text) : 0), 0);
  }
  return 0;
}

/**
 * NOVO: Função para imprimir o relatório de contexto.
 * @param {object} params
 * @param {object[]} params.vectorMemory - A memória vetorial.
 * @param {number} params.historyWordCount - A contagem de palavras do histórico.
 */
function printContextReport({ vectorMemory, historyWordCount }) {
  const memoryWordCount = countWords(vectorMemory);
  const totalWordCount = memoryWordCount + historyWordCount;

  console.log("   --- Relatório de Contexto ---");
  console.log(`   | 🧠 Memória Vetorial: ${memoryWordCount} palavras`);
  console.log(`   | 💬 Histórico Conversa: ${historyWordCount} palavras`);
  console.log(`   | 📈 Total: ${totalWordCount} palavras`);
  console.log("   -----------------------------");
}


/**
 * Função principal que executa o fluxo de teste de RAG.
 */
async function testRagFlow() {
  console.log("🚀 INICIANDO TESTE AVANÇADO: RAG E MEMÓRIA VETORIAL 🚀");

  let chatToken = null;
  let messageIdToEdit = null;
  // NOVO: Estado para armazenar a memória vetorial entre as chamadas
  let vectorMemory = [];

  try {
    // --- ETAPA 1: Criar um novo chat ---
    printSection("ETAPA 1: CRIANDO NOVO CHAT");
    const createResponse = await axios.post(`${BASE_URL}/create`);
    chatToken = createResponse.data.chatToken;
    console.log(`Chat criado com sucesso! Token: ${chatToken}`);

    // --- ETAPA 2: Inserir a mensagem original (contexto inicial) ---
    printSection("ETAPA 2: INSERINDO MENSAGEM ORIGINAL (SOBRE MARTE)");
    const originalMessage =
      "Meu planeta favorito é Marte. Ele também é conhecido como o Planeta Vermelho devido à sua superfície rica em óxido de ferro.";
    console.log(`   >> Usuário (Inserindo): "${originalMessage}"`);
    const insertResponse = await axios.post(
      `${BASE_URL}/insert/${chatToken}/historico`,
      { text: originalMessage }
    );
    messageIdToEdit = insertResponse.data.messageid;
    console.log(`Mensagem inserida com sucesso! Message ID: ${messageIdToEdit}`);

    // --- ETAPA 3: Fazer uma pergunta (PRIMEIRA chamada com RAG) ---
    printSection("ETAPA 3: TESTANDO RAG (BUSCA POR 'GEOLOGIA')");
    const contextualQuestion1 = "Fale mais sobre a geologia desse planeta.";
    console.log(`   >> Usuário (Perguntando): "${contextualQuestion1}"`);

    // MODIFICADO: Envia a memória vetorial (vazia na primeira vez)
    const generateResponse1 = await axios.post(
      `${BASE_URL}/generate/${chatToken}`,
      { message: contextualQuestion1, previousVectorMemory: vectorMemory }
    );

    // MODIFICADO: Extrai todos os campos da resposta, incluindo a nova memória
    const {
      modelResponse: modelResponse1,
      history: history1,
      wordCount: wordCount1,
      newVectorMemory: newVectorMemory1,
    } = generateResponse1.data;

    // ATUALIZA o estado da memória vetorial
    vectorMemory = newVectorMemory1;

    console.log(`   << Gemini (Resposta sobre MARTE): "${modelResponse1.substring(0, 100)}..."`);
    printContextReport({ vectorMemory: vectorMemory, historyWordCount: wordCount1 });

    // Validações
    if (!modelResponse1.toLowerCase().includes("marte")) {
      console.warn("   ⚠️ AVISO: A resposta não mencionou 'Marte'.");
    }
    if (!Array.isArray(vectorMemory) || vectorMemory.length === 0) {
      throw new Error("Falha na validação: A memória vetorial não foi preenchida.");
    }
    console.log(`   👍 Validação da Resposta 1: OK! Memória vetorial com ${vectorMemory.length} itens.`);

    // --- ETAPA 4: Fazer uma SEGUNDA pergunta para testar a memória persistente ---
    printSection("ETAPA 4: TESTANDO RAG COM MEMÓRIA PERSISTENTE");
    const contextualQuestion2 = "E sobre sua atmosfera?";
    console.log(`   >> Usuário (Perguntando): "${contextualQuestion2}"`);

    // MODIFICADO: Envia a memória vetorial PREENCHIDA na chamada anterior
    const generateResponse2 = await axios.post(
      `${BASE_URL}/generate/${chatToken}`,
      { message: contextualQuestion2, previousVectorMemory: vectorMemory }
    );

    const {
      modelResponse: modelResponse2,
      history: history2,
      wordCount: wordCount2,
      newVectorMemory: newVectorMemory2,
    } = generateResponse2.data;
    
    // ATUALIZA o estado da memória vetorial novamente
    vectorMemory = newVectorMemory2;

    console.log(`   << Gemini (Resposta sobre ATMOSFERA): "${modelResponse2.substring(0, 100)}..."`);
    printContextReport({ vectorMemory: vectorMemory, historyWordCount: wordCount2 });

    // Validações
    const isSuccess = modelResponse2.toLowerCase().includes("atmosfera") && modelResponse2.toLowerCase().includes("marte");
    if (!isSuccess) {
       console.warn("   ⚠️ AVISO: A resposta não parece contextual.");
    }
    if (!Array.isArray(vectorMemory) || vectorMemory.length === 0) {
      throw new Error("Falha na validação: A memória vetorial está vazia.");
    }
    console.log(`   👍 Validação da Resposta 2: OK! Memória vetorial atualizada com ${vectorMemory.length} itens.`);

    printSection("ETAPA 5: VALIDAÇÃO FINAL DO FLUXO RAG");
    if (generateResponse1.data && generateResponse2.data) {
        console.log("🎉🎉 SUCESSO! O fluxo de RAG com memória persistente foi concluído.");
    } else {
        console.log("❌❌ FALHA! Ocorreu um problema no fluxo de RAG.");
    }


  } catch (error) {
    console.error("\n❌ OCORREU UM ERRO DURANTE O TESTE ❌");
    if (error.response) {
      console.error("   Status:", error.response.status);
      console.error("   Dados do Erro:", error.response.data);
    } else if (error.request) {
      console.error("   Erro de conexão: Não foi possível conectar ao servidor.");
    } else {
      console.error("   Erro:", error.message);
    }
  }
}

// Executa o teste
testRagFlow();