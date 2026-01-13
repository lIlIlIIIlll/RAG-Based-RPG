// src/services/lancedb.service.js
const lancedb = require("@lancedb/lancedb");
const { Index } = require("@lancedb/lancedb");
const path = require("path");
const fs = require("fs");
const config = require("../config");
const { chatMessageSchema } = require("../config/lancedb.schema");
const { hebbianAssociationSchema } = require("../config/hebbian.schema");

const dbPath = path.join(process.cwd(), config.dbPath);

// Garante que o diretório do banco de dados exista
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

// Cached DB connection for performance
let cachedDb = null;

/**
 * Obtém uma conexão com o banco de dados LanceDB (cached).
 * @returns {Promise<lancedb.Connection>}
 */
async function getDbConnection() {
  if (!cachedDb) {
    cachedDb = await lancedb.connect(dbPath);
  }
  return cachedDb;
}

/**
 * Cria e inicializa as tabelas para um novo chat.
 * @param {string} chatToken - O identificador único do chat.
 */
async function initializeCollections(chatToken) {
  const db = await getDbConnection();

  for (const name of config.collectionNames) {
    const tableName = `${chatToken}-${name}`;
    try {
      await db.createEmptyTable(tableName, chatMessageSchema);
      console.log(`[LanceDB] Tabela '${tableName}' criada com schema.`);

      const table = await db.openTable(tableName);
      await table.createIndex("messageid", {
        config: Index.btree(),
        replace: true,
      });
      console.log(
        `[LanceDB] Índice B-Tree em 'messageid' para '${tableName}' criado.`
      );
    } catch (e) {
      if (e.message?.toLowerCase().includes("already exists")) {
        console.log(
          `[LanceDB] Tabela '${tableName}' já existe. Pulando criação.`
        );
      } else {
        console.error(
          `[LanceDB] Erro ao criar tabela '${tableName}':`,
          e
        );
        throw e;
      }
    }
  }
}

/**
 * Remove todas as tabelas associadas a um chat.
 * @param {string} chatToken 
 */
async function deleteChatTables(chatToken) {
  const db = await getDbConnection();
  console.log(`[LanceDB] Iniciando remoção das tabelas do chat: ${chatToken}`);

  for (const name of config.collectionNames) {
    const tableName = `${chatToken}-${name}`;
    try {
      // Verifica se a tabela existe antes de tentar deletar (listando tabelas)
      const existingTables = await db.tableNames();
      if (existingTables.includes(tableName)) {
        await db.dropTable(tableName);
        console.log(`[LanceDB] Tabela removida: ${tableName}`);
      } else {
        console.log(`[LanceDB] Tabela não encontrada para remoção: ${tableName}`);
      }
    } catch (e) {
      console.error(`[LanceDB] Erro ao remover tabela '${tableName}':`, e);
      // Não lança erro para permitir que o loop continue para outras tabelas
    }
  }
}

/**
 * Insere um novo registro em uma coleção específica.
 * @param {string} chatToken
 * @param {string} collectionName
 * @param {object} record - { text, vector, messageid, role }
 */
async function insertRecord(chatToken, collectionName, record) {
  const db = await getDbConnection();
  const tableName = `${chatToken}-${collectionName}`;
  const table = await db.openTable(tableName);
  await table.add([record]);
  console.log(
    `[LanceDB] Registro inserido em ${tableName} com messageid: ${record.messageid}.`
  );
}

/**
 * Realiza uma busca vetorial em uma coleção.
 * @param {string} chatToken
 * @param {string} collectionName
 * @param {number[]} queryVector
 * @returns {Promise<object[]>}
 */
async function searchByVector(chatToken, collectionName, queryVector, limit = 10) {
  const db = await getDbConnection();
  const tableName = `${chatToken}-${collectionName}`;
  const table = await db.openTable(tableName);

  const results = await table.search(queryVector).limit(limit).toArray();
  console.log(
    `[LanceDB] Busca em ${tableName} retornou ${results.length} resultados.`
  );
  // DEBUG: Mostra distâncias retornadas
  if (results.length > 0) {
    console.log(`[LanceDB DEBUG] Primeiros 3 resultados _distance:`, results.slice(0, 3).map(r => ({ text: r.text?.substring(0, 30), _distance: r._distance })));
  }
  return results;
}

/**
 * Busca e retorna todos os registros de uma coleção específica.
 * @param {string} chatToken O token do chat.
 * @param {string} collectionName O nome da coleção (ex: 'historico').
 * @returns {Promise<object[]>} Um array com todos os registros da tabela.
 */
async function getAllRecordsFromCollection(chatToken, collectionName) {
  const db = await getDbConnection();
  const tableName = `${chatToken}-${collectionName}`;

  // Verifica existência antes de abrir
  const existingTables = await db.tableNames();
  if (!existingTables.includes(tableName)) {
    console.warn(`[LanceDB] Tabela '${tableName}' não existe. Retornando vazio.`);
    return [];
  }

  console.log(`[LanceDB] Buscando todos os registros de '${tableName}'...`);
  const table = await db.openTable(tableName);
  const records = await table.query().toArray();
  console.log(
    `[LanceDB] Encontrados ${records.length} registros em '${tableName}'.`
  );

  // Ordena por createdAt se disponível
  records.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  return records;
}

/**
 * Atualiza um registro buscando pelo messageid em todas as coleções do chat.
 * A atualização é feita via delete + add.
 * @param {string} chatToken
 * @param {string} messageid
 * @param {string} newText
 * @param {number[]} newVector
 * @returns {Promise<boolean>} - Retorna true se a atualização foi bem-sucedida.
 */
async function updateRecordByMessageId(
  chatToken,
  messageid,
  newText,
  newVector
) {
  const db = await getDbConnection();
  let recordUpdated = false;

  for (const collectionName of config.collectionNames) {
    const tableName = `${chatToken}-${collectionName}`;
    try {
      const table = await db.openTable(tableName);

      const recordsFound = await table
        .query()
        .where(`messageid = '${messageid}'`)
        .limit(1)
        .toArray();

      if (recordsFound.length > 0) {
        console.log(
          `[LanceDB] Registro encontrado em ${tableName}. Atualizando...`
        );

        const oldRecord = recordsFound[0];

        await table.delete(`messageid = '${messageid}'`);

        await table.add([
          {
            text: newText,
            vector: newVector,
            messageid,
            role: oldRecord.role ?? null,
            createdAt: oldRecord.createdAt ?? Date.now(),
          },
        ]);
        console.log(`[LanceDB] Atualização concluída em ${tableName}.`);

        recordUpdated = true;
        break;
      }
    } catch (error) {
      if (!error.message?.toLowerCase().includes("was not found")) {
        console.error(
          `[LanceDB] Erro ao tentar atualizar em ${tableName}:`,
          error
        );
      }
    }
  }

  return recordUpdated;
}

/**
 * Deleta um registro específico pelo ID em qualquer coleção do chat.
 * @param {string} chatToken 
 * @param {string} messageid 
 * @returns {Promise<boolean>} True se deletou algo.
 */
async function deleteRecordByMessageId(chatToken, messageid) {
  const db = await getDbConnection();
  let recordDeleted = false;

  for (const collectionName of config.collectionNames) {
    const tableName = `${chatToken}-${collectionName}`;
    try {
      const table = await db.openTable(tableName);

      // Tenta deletar
      await table.delete(`messageid = '${messageid}'`);

      // IMPORTANTE: LanceDB usa tombstones - deletions são marcadas mas não removidas
      // até que compact() seja chamado. Sem compact, buscas vetoriais ainda retornam 
      // registros "deletados".
      await table.compact();

      console.log(`[LanceDB] Deletado e compactado em ${tableName} para id ${messageid}`);
      recordDeleted = true;

    } catch (error) {
      if (!error.message?.toLowerCase().includes("was not found")) {
        // Ignora erro de tabela não encontrada, loga outros
        console.error(`[LanceDB] Erro ao deletar de ${tableName}:`, error);
      }
    }
  }
  return recordDeleted;
}

/**
 * Busca vetorial em múltiplos chats em paralelo.
 * @param {string[]} chatTokens - Lista de chat tokens
 * @param {string[]} collections - Coleções a buscar
 * @param {number[]} queryVector - Vetor de busca
 * @param {number} limitPerChat - Limite de resultados por chat/coleção
 * @returns {Promise<object[]>} - Resultados agregados
 */
async function searchAcrossChats(chatTokens, collections, queryVector, limitPerChat = 3) {
  const db = await getDbConnection();
  const existingTables = await db.tableNames();

  const searchPromises = chatTokens.flatMap(token =>
    collections.map(async col => {
      const tableName = `${token}-${col}`;
      if (!existingTables.includes(tableName)) return [];

      try {
        const table = await db.openTable(tableName);
        let results;

        if (col === 'historico') {
          // Para histórico, busca mais mas retorna só os mais recentes
          const allResults = await table.search(queryVector).limit(100).toArray();
          // Ordena por createdAt e pega as últimas 50
          allResults.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          results = allResults.slice(0, 50);
        } else {
          results = await table.search(queryVector).limit(limitPerChat).toArray();
        }

        return results.map(r => ({
          ...r,
          chatToken: token,
          collection: col,
          // _distance é retornado pelo LanceDB (menor = mais similar)
          relevanceScore: r._distance ? (1 / (1 + r._distance)) : 0
        }));
      } catch (err) {
        console.warn(`[LanceDB] Erro ao buscar em ${tableName}:`, err.message);
        return [];
      }
    })
  );

  const allResults = await Promise.all(searchPromises);
  return allResults.flat();
}

// ============================================
// HYBRID SEARCH (BM25 + Vetorial)
// ============================================

/**
 * Realiza busca híbrida combinando vetorial + full-text search.
 * @param {string} chatToken
 * @param {string} collectionName
 * @param {number[]} queryVector
 * @param {string} queryText
 * @param {number} limit
 * @returns {Promise<object[]>}
 */
async function hybridSearch(chatToken, collectionName, queryVector, queryText, limit = 50) {
  const db = await getDbConnection();
  const tableName = `${chatToken}-${collectionName}`;

  try {
    const table = await db.openTable(tableName);

    // Busca vetorial (principal)
    const vectorResults = await table.search(queryVector).limit(limit).toArray();

    // Nota: LanceDB FTS requer índice FTS criado previamente com createIndex()
    // Por ora, focamos na busca vetorial que é mais robusta
    // O RRF ainda funciona com apenas um conjunto de resultados
    const textResults = [];

    // Reciprocal Rank Fusion (funciona mesmo com textResults vazio)
    const combined = reciprocalRankFusion(vectorResults, textResults);
    console.log(`[LanceDB] Hybrid search em ${tableName}: ${vectorResults.length} resultados.`);

    return combined.slice(0, limit);
  } catch (e) {
    console.warn(`[LanceDB] Erro em hybrid search ${tableName}:`, e.message);
    return [];
  }
}

/**
 * Reciprocal Rank Fusion para combinar resultados de múltiplas buscas.
 * @param  {...object[]} resultSets - Arrays de resultados para fundir
 * @returns {object[]} - Resultados combinados e ordenados
 */
function reciprocalRankFusion(...resultSets) {
  const k = 60; // Parâmetro RRF padrão
  const scores = new Map();
  const items = new Map();

  for (const results of resultSets) {
    results.forEach((item, rank) => {
      const id = item.messageid;
      const score = 1 / (k + rank + 1);
      scores.set(id, (scores.get(id) || 0) + score);
      if (!items.has(id)) items.set(id, item);
    });
  }

  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id, score]) => ({ ...items.get(id), _rrfScore: score }));
}

// ============================================
// FREQUENCY BIAS (Neuroplasticidade)
// ============================================

/**
 * Marca memórias como acessadas (incrementa accessCount).
 * @param {string} chatToken
 * @param {string[]} messageids
 * @param {number} currentMessageCount
 */
async function markMemoriesAccessed(chatToken, messageids, currentMessageCount) {
  const db = await getDbConnection();

  for (const collectionName of config.collectionNames) {
    const tableName = `${chatToken}-${collectionName}`;
    try {
      const table = await db.openTable(tableName);

      for (const messageid of messageids) {
        const records = await table.query().where(`messageid = '${messageid}'`).limit(1).toArray();
        if (records.length > 0) {
          const record = records[0];
          const newAccessCount = (record.accessCount || 0) + 1;

          // Update via delete + add
          await table.delete(`messageid = '${messageid}'`);
          await table.add([{
            ...record,
            accessCount: newAccessCount,
            lastMessageAccessed: currentMessageCount
          }]);
        }
      }
    } catch (e) {
      // Ignora erros de tabelas não encontradas
    }
  }

  console.log(`[LanceDB] Marcadas ${messageids.length} memórias como acessadas.`);
}

/**
 * Aplica frequency bias aos resultados (memórias mais acessadas ganham boost).
 * @param {object[]} results
 * @returns {object[]}
 */
function applyFrequencyBias(results) {
  return results.map(r => {
    const accessCount = r.accessCount || 0;
    // Log para evitar explosão, max 30% de boost
    const frequencyBoost = Math.min(0.30, Math.log(1 + accessCount) * 0.05);

    // Guarda distância original, usa 1 como fallback se undefined
    const originalDistance = r._distance ?? r._rrfScore ?? 1;

    return {
      ...r,
      _originalDistance: originalDistance,
      _distance: originalDistance * (1 - frequencyBoost),
      _frequencyBoost: frequencyBoost
    };
  });
}

// ============================================
// HEBBIAN ASSOCIATIONS
// ============================================

/**
 * Inicializa tabela de associações Hebbianas para um chat.
 * @param {string} chatToken
 */
async function initializeHebbianTable(chatToken) {
  const db = await getDbConnection();
  const tableName = `${chatToken}-hebbian`;

  try {
    await db.createEmptyTable(tableName, hebbianAssociationSchema);
    console.log(`[LanceDB] Tabela Hebbiana '${tableName}' criada.`);
  } catch (e) {
    if (!e.message?.toLowerCase().includes("already exists")) {
      console.error(`[LanceDB] Erro ao criar tabela Hebbiana:`, e);
    }
  }
}

/**
 * Atualiza associações Hebbianas após uma busca (co-ocorrência).
 * @param {string} chatToken
 * @param {object[]} retrievedMemories
 * @param {number} currentMessageCount
 */
async function updateHebbianAssociations(chatToken, retrievedMemories, currentMessageCount) {
  const db = await getDbConnection();
  const tableName = `${chatToken}-hebbian`;
  const LEARNING_RATE = 0.1;
  const MAX_STRENGTH = 0.95;
  const MAX_ASSOCIATIONS_PER_MEMORY = 20;

  try {
    // Tenta abrir a tabela, cria se não existir
    let table;
    try {
      table = await db.openTable(tableName);
    } catch (e) {
      await initializeHebbianTable(chatToken);
      table = await db.openTable(tableName);
    }

    // Gera pares de memórias co-recuperadas
    for (let i = 0; i < retrievedMemories.length && i < 10; i++) {
      for (let j = i + 1; j < retrievedMemories.length && j < 10; j++) {
        const sourceId = retrievedMemories[i].messageid;
        const targetId = retrievedMemories[j].messageid;

        // Busca associação existente
        const existing = await table.query()
          .where(`("sourceId" = '${sourceId}' AND "targetId" = '${targetId}') OR ("sourceId" = '${targetId}' AND "targetId" = '${sourceId}')`)
          .limit(1)
          .toArray();

        const proximityBonus = 1 - (Math.abs(i - j) / retrievedMemories.length);

        if (existing.length > 0) {
          // Atualiza associação existente
          const assoc = existing[0];
          const newStrength = Math.min(MAX_STRENGTH, assoc.strength + LEARNING_RATE * proximityBonus);

          await table.delete(`"sourceId" = '${assoc.sourceId}' AND "targetId" = '${assoc.targetId}'`);
          await table.add([{
            ...assoc,
            strength: newStrength,
            coOccurrences: (assoc.coOccurrences || 0) + 1,
            lastMessageUpdated: currentMessageCount
          }]);
        } else {
          // Cria nova associação
          await table.add([{
            sourceId,
            targetId,
            strength: LEARNING_RATE * proximityBonus,
            coOccurrences: 1,
            lastMessageUpdated: currentMessageCount,
            chatToken
          }]);
        }
      }
    }

    console.log(`[LanceDB] Associações Hebbianas atualizadas para ${Math.min(10, retrievedMemories.length)} memórias.`);
  } catch (e) {
    console.warn(`[LanceDB] Erro ao atualizar associações Hebbianas:`, e.message);
  }
}

/**
 * Aplica boost Hebbiano (puxa memórias associadas).
 * @param {string} chatToken
 * @param {object[]} results
 * @returns {Promise<object[]>}
 */
async function applyHebbianBoost(chatToken, results) {
  const db = await getDbConnection();
  const tableName = `${chatToken}-hebbian`;
  const MIN_STRENGTH = 0.3; // Só puxa se associação for forte
  const boostedResults = [...results];
  const existingIds = new Set(results.map(r => r.messageid));

  try {
    const table = await db.openTable(tableName);

    for (const memory of results.slice(0, 5)) { // Limita a 5 para performance
      // Busca associações fortes
      const associations = await table.query()
        .where(`("sourceId" = '${memory.messageid}' OR "targetId" = '${memory.messageid}') AND "strength" >= ${MIN_STRENGTH}`)
        .limit(5)
        .toArray();

      for (const assoc of associations) {
        const linkedId = assoc.sourceId === memory.messageid ? assoc.targetId : assoc.sourceId;

        if (!existingIds.has(linkedId)) {
          // Busca a memória associada
          for (const collectionName of config.collectionNames) {
            const collTable = await db.openTable(`${chatToken}-${collectionName}`);
            const linked = await collTable.query().where(`messageid = '${linkedId}'`).limit(1).toArray();

            if (linked.length > 0) {
              const linkedMemory = linked[0];
              // Boost baseado na força da associação (max 30%)
              const hebbianBoost = assoc.strength * 0.30;
              linkedMemory._distance = (linkedMemory._distance || 1) * (1 - hebbianBoost);
              linkedMemory._hebbianPulledBy = memory.messageid;
              linkedMemory._hebbianStrength = assoc.strength;
              linkedMemory.category = collectionName;

              boostedResults.push(linkedMemory);
              existingIds.add(linkedId);
              break;
            }
          }
        }
      }
    }

    console.log(`[LanceDB] Hebbian boost: ${boostedResults.length - results.length} memórias puxadas.`);
  } catch (e) {
    // Tabela pode não existir ainda
  }

  return boostedResults;
}

/**
 * Aplica decay sináptico (enfraquece associações não usadas).
 * @param {string} chatToken
 * @param {number} currentMessageCount
 * @param {number} decayRate
 */
async function applySynapticDecay(chatToken, currentMessageCount, decayRate = 0.01) {
  const db = await getDbConnection();
  const tableName = `${chatToken}-hebbian`;
  const MIN_STRENGTH = 0.05;

  try {
    const table = await db.openTable(tableName);
    const associations = await table.query().toArray();

    let decayed = 0;
    let deleted = 0;

    for (const assoc of associations) {
      const messagesSinceUpdate = currentMessageCount - (assoc.lastMessageUpdated || 0);
      const decayFactor = Math.exp(-decayRate * messagesSinceUpdate);
      const newStrength = assoc.strength * decayFactor;

      await table.delete(`"sourceId" = '${assoc.sourceId}' AND "targetId" = '${assoc.targetId}'`);

      if (newStrength >= MIN_STRENGTH) {
        await table.add([{ ...assoc, strength: newStrength }]);
        decayed++;
      } else {
        deleted++;
      }
    }

    console.log(`[LanceDB] Synaptic decay: ${decayed} associações enfraquecidas, ${deleted} esquecidas.`);
  } catch (e) {
    // Tabela pode não existir
  }
}

module.exports = {
  initializeCollections,
  deleteChatTables,
  insertRecord,
  searchByVector,
  getAllRecordsFromCollection,
  updateRecordByMessageId,
  deleteRecordByMessageId,
  searchAcrossChats,
  // Novas funções RAG
  hybridSearch,
  reciprocalRankFusion,
  // Frequency Bias
  markMemoriesAccessed,
  applyFrequencyBias,
  // Hebbian
  initializeHebbianTable,
  updateHebbianAssociations,
  applyHebbianBoost,
  applySynapticDecay,
  // Embedding Check & Repair
  countZeroEmbeddings: async function (chatToken, collections = ['conceitos', 'fatos', 'historico']) {
    const db = await getDbConnection();
    let total = 0;
    const byCollection = {};

    const isZeroVector = (vector) => {
      if (!vector || !Array.isArray(vector)) return true;
      const sum = vector.reduce((acc, val) => acc + Math.abs(val), 0);
      return sum < 0.001;
    };

    for (const collectionName of collections) {
      const tableName = `${chatToken}-${collectionName}`;
      byCollection[collectionName] = 0;

      try {
        const existingTables = await db.tableNames();
        if (!existingTables.includes(tableName)) continue;

        const table = await db.openTable(tableName);
        const allRecords = await table.query().toArray();

        for (const record of allRecords) {
          if (isZeroVector(record.vector) && record.text?.trim().length > 0) {
            total++;
            byCollection[collectionName]++;
          }
        }
      } catch (e) {
        // Tabela pode não existir
      }
    }

    return { total, byCollection };
  },
  repairZeroEmbeddings: async function (chatToken, generateEmbeddingFn, apiKey, collections = ['conceitos', 'fatos']) {
    const db = await getDbConnection();
    const results = {
      repaired: 0,
      failed: 0,
      skipped: 0,
      details: []
    };

    // Função auxiliar para verificar vetor zerado
    const isZeroVector = (vector) => {
      if (!vector || !Array.isArray(vector)) return true;
      const sum = vector.reduce((acc, val) => acc + Math.abs(val), 0);
      return sum < 0.001;
    };

    console.log(`[LanceDB] Iniciando reparo de embeddings para chat ${chatToken}...`);

    for (const collectionName of collections) {
      const tableName = `${chatToken}-${collectionName}`;

      try {
        const existingTables = await db.tableNames();
        if (!existingTables.includes(tableName)) {
          console.log(`[LanceDB] Tabela ${tableName} não existe, pulando.`);
          continue;
        }

        const table = await db.openTable(tableName);
        const allRecords = await table.query().toArray();

        console.log(`[LanceDB] Verificando ${allRecords.length} registros em ${tableName}...`);

        for (const record of allRecords) {
          if (isZeroVector(record.vector)) {
            console.log(`[LanceDB] Vetor zerado: "${record.text?.substring(0, 50)}..."`);

            if (!record.text || record.text.trim().length === 0) {
              results.skipped++;
              continue;
            }

            try {
              const newVector = await generateEmbeddingFn(record.text, apiKey);

              if (!newVector || isZeroVector(newVector)) {
                results.failed++;
                results.details.push({
                  messageid: record.messageid,
                  text: record.text?.substring(0, 100),
                  collection: collectionName,
                  status: 'failed',
                  reason: 'Generated embedding is still zero'
                });
                continue;
              }

              await table.delete(`messageid = '${record.messageid}'`);
              await table.add([{ ...record, vector: newVector }]);

              console.log(`[LanceDB] ✓ Reparado: "${record.text?.substring(0, 50)}..."`);
              results.repaired++;
              results.details.push({
                messageid: record.messageid,
                text: record.text?.substring(0, 100),
                collection: collectionName,
                status: 'repaired'
              });

              await new Promise(resolve => setTimeout(resolve, 500));
            } catch (err) {
              console.error(`[LanceDB] Erro:`, err.message);
              results.failed++;
              results.details.push({
                messageid: record.messageid,
                text: record.text?.substring(0, 100),
                collection: collectionName,
                status: 'failed',
                reason: err.message
              });
            }
          }
        }
      } catch (tableError) {
        console.error(`[LanceDB] Erro ao processar ${tableName}:`, tableError.message);
      }
    }

    console.log(`[LanceDB] Reparo concluído: ${results.repaired} reparados, ${results.failed} falhas, ${results.skipped} pulados.`);
    return results;
  }
};
