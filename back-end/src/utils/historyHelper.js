// src/utils/historyHelper.js

/**
 * Conta o número de palavras em uma string.
 * Uma sequência de um ou mais caracteres de espaço em branco é tratada como um separador.
 * @param {string} text - O texto para contar as palavras.
 * @returns {number} O número de palavras.
 */
function countWords(text) {
  // Retorna 0 se o texto for nulo, indefinido ou vazio.
  if (!text) {
    return 0;
  }
  // Divide a string por um ou mais espaços em branco (incluindo espaços, tabs, newlines)
  // e retorna o comprimento do array resultante.
  return text.trim().split(/\s+/).length;
}

/**
 * Filtra o histórico de mensagens para incluir aproximadamente as últimas N palavras.
 * Começa a contar da mensagem mais recente para a mais antiga, garantindo que
 * nenhuma mensagem seja cortada ao meio.
 *
 * @param {Array<object>} fullHistory - O array completo de registros de mensagens.
 * @param {number} wordLimit - O número máximo de palavras desejado no histórico.
 * @returns {{limitedHistory: Array<object>, wordCount: number}} - Um objeto contendo o histórico filtrado e a contagem total de palavras.
 */
function getHistoryWithWordLimit(fullHistory, wordLimit) {
  const limitedHistory = [];
  let currentWordCount = 0;

  // Itera sobre o histórico de trás para frente (do mais recente para o mais antigo).
  for (let i = fullHistory.length - 1; i >= 0; i--) {
    const message = fullHistory[i];
    const wordsInMessage = countWords(message.text);

    // Adiciona a mensagem atual, mesmo que ela sozinha ultrapasse o limite.
    // Isso garante que a mensagem mais recente esteja sempre presente e que
    // a iteração pare após incluir uma mensagem que exceda o limite.
    if (currentWordCount < wordLimit) {
      limitedHistory.push(message);
      currentWordCount += wordsInMessage;
    } else {
      // Para a iteração assim que o limite for atingido ou ultrapassado.
      break;
    }
  }

  // A lista foi construída na ordem inversa (recente -> antigo),
  // então precisamos revertê-la para a ordem cronológica correta (antigo -> recente).
  const finalHistory = limitedHistory.reverse();

  console.log(
    `[History Helper] Histórico filtrado para as últimas ${currentWordCount} palavras em ${finalHistory.length} mensagens.`
  );

  return {
    limitedHistory: finalHistory,
    wordCount: currentWordCount,
  };
}

module.exports = {
  getHistoryWithWordLimit,
  countWords,
};