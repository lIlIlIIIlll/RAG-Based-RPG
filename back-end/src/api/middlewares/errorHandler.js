// src/api/middlewares/errorHandler.js

/**
 * Middleware para tratamento de erros. Captura erros passados pelo next(error).
 * @param {Error} err - O objeto de erro.
 * @param {import('express').Request} req - O objeto de requisição.
 * @param {import('express').Response} res - O objeto de resposta.
 * @param {import('express').NextFunction} next - A função next.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  console.error("[Error Handler] Ocorreu um erro:", err.stack);

  // Verifica se o erro é por "não encontrado" vindo do LanceDB
  if (err.message?.toLowerCase().includes("was not found")) {
    return res.status(404).json({
      error: "Recurso não encontrado",
      details:
        "A tabela ou coleção especificada não existe para este chatToken.",
    });
  }

  // Resposta genérica para outros erros
  res.status(500).json({
    error: "Erro interno do servidor",
    details: err.message || "Algo deu muito errado!",
  });
}

module.exports = errorHandler;
