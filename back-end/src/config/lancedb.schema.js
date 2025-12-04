// src/config/lancedb.schema.js
const {
  Field,
  Float32,
  Utf8,
  FixedSizeList,
  Schema,
  Float64,
} = require("apache-arrow");
const { embeddingDimension } = require("./index");

// Schema base para qualquer coleção (historico, fatos, conceitos)
const chatMessageSchema = new Schema([
  new Field("text", new Utf8()),
  new Field(
    "vector",
    new FixedSizeList(
      embeddingDimension,
      new Field("item", new Float32())
    )
  ),
  new Field("messageid", new Utf8()),

  // Campo extra para sabermos quem "falou" (user / model / etc.)
  new Field("role", new Utf8()),

  // Timestamp para ordenação
  new Field("createdAt", new Float64()),

  // Anexos (arquivos) serializados como JSON
  new Field("attachments", new Utf8(), true), // nullable

  // Assinatura de pensamento do Gemini 3.0 (para manter contexto de reasoning)
  new Field("thoughtSignature", new Utf8(), true), // nullable
]);

module.exports = { chatMessageSchema };
