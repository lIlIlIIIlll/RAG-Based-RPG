// src/services/logger.js

/**
 * Gera um timestamp no formato HH:MM:SS.
 * @returns {string} O timestamp formatado.
 */
function getTimestamp() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Função de log padronizada para o console do navegador.
 * Formato: [HH:MM:SS] | [CONTEXTO] -> Mensagem
 * @param {string} context - O contexto da mensagem (ex: 'SISTEMA', 'API', 'CHAT').
 * @param {string} message - A mensagem a ser logada.
 * @param {'log' | 'warn' | 'error'} type - O tipo de log a ser usado no console.
 * @param {object | null} [data=null] - Dados opcionais a serem exibidos abaixo do log.
 */
function log(context, message, type = "log", data = null) {
  const timestamp = getTimestamp();
  const formattedMessage = `[${timestamp}] | [${context}] -> ${message}`;

  // Escolhe o método do console com base no tipo
  switch (type) {
    case "warn":
      console.warn(formattedMessage);
      break;
    case "error":
      console.error(formattedMessage);
      break;
    default:
      console.log(formattedMessage);
      break;
  }

  // Se houver dados adicionais, exibe-os
  if (data) {
    console.log(data);
  }
}

// Exporta a função para ser usada em outros módulos
export default log;