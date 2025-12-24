// src/config/hebbian.schema.js
const {
    Field,
    Float64,
    Utf8,
    Schema,
} = require("apache-arrow");

// Schema para associações Hebbianas entre memórias
// "Neurons that fire together, wire together"
const hebbianAssociationSchema = new Schema([
    // IDs das memórias conectadas
    new Field("sourceId", new Utf8()),      // messageid origem
    new Field("targetId", new Utf8()),      // messageid destino

    // Força da associação (0.0 - 1.0)
    new Field("strength", new Float64()),

    // Quantas vezes foram co-recuperadas
    new Field("coOccurrences", new Float64()),

    // Número da mensagem na última atualização (para decay baseado em mensagens)
    new Field("lastMessageUpdated", new Float64()),

    // Chat ao qual pertence
    new Field("chatToken", new Utf8()),
]);

module.exports = { hebbianAssociationSchema };
