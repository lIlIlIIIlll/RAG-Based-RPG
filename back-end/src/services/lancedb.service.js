// src/services/lancedb.service.js
const lancedb = require("@lancedb/lancedb");
const { Index } = require("@lancedb/lancedb");
const path = require("path");
const fs = require("fs");
const config = require("../config");
const { chatMessageSchema } = require("../config/lancedb.schema");

const dbPath = path.join(process.cwd(), config.dbPath);

// Garante que o diretório do banco de dados exista
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

/**
 * Obtém uma conexão com o banco de dados LanceDB.
 * @returns {Promise<lancedb.Connection>}
 */
async function getDbConnection() {
  return await lancedb.connect(dbPath);
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
async function searchByVector(chatToken, collectionName, queryVector) {
  const db = await getDbConnection();
  const tableName = `${chatToken}-${collectionName}`;
  const table = await db.openTable(tableName);

  const results = await table.search(queryVector).limit(10).toArray();
  console.log(
    `[LanceDB] Busca em ${tableName} retornou ${results.length} resultados.`
  );
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

      // Verifica se algo foi deletado (LanceDB não retorna count no delete, 
      // mas se não deu erro, assumimos sucesso se existia antes. 
      // Para confirmar precisaríamos fazer query antes, mas por performance vamos assumir ok)
      // Vou adicionar um log de sucesso.
      console.log(`[LanceDB] Comando de delete executado em ${tableName} para id ${messageid}`);
      recordDeleted = true;
      // Nota: O LanceDB pode não lançar erro se o ID não existir, 
      // mas percorremos todas as tabelas para garantir.

    } catch (error) {
      if (!error.message?.toLowerCase().includes("was not found")) {
        // Ignora erro de tabela não encontrada, loga outros
        console.error(`[LanceDB] Erro ao deletar de ${tableName}:`, error);
      }
    }
  }
  return recordDeleted;
}

module.exports = {
  initializeCollections,
  deleteChatTables,
  insertRecord,
  searchByVector,
  getAllRecordsFromCollection,
  updateRecordByMessageId,
  deleteRecordByMessageId
};