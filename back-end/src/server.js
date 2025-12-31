// src/server.js
const app = require("./app"); // Importa a aplicação configurada
const config = require("./config");

const port = config.port;

// Inicia o servidor e o faz escutar na porta definida
app.listen(port, "0.0.0.0", () => {
  console.log("======================================================");
  console.log(`  🚀 Servidor modularizado rodando com sucesso!`);
  console.log(`     Ouvindo em http://localhost:${port}`);
  console.log("======================================================");
});
