// src/services/pdf.service.js
// Serviço para extração de texto e vetorização de PDFs

const pdfParse = require("pdf-parse");
const { v4: uuidv4 } = require("uuid");
const geminiService = require("./gemini.service");
const lanceDBService = require("./lancedb.service");
const config = require("../config");

/**
 * Extrai texto de um PDF a partir de dados base64.
 * @param {string} base64Data - Dados do PDF em base64.
 * @returns {Promise<{text: string, numPages: number, info: object}>}
 */
async function extractTextFromPDF(base64Data) {
    try {
        // Converte base64 para Buffer
        const pdfBuffer = Buffer.from(base64Data, "base64");

        // Extrai texto usando pdf-parse
        const data = await pdfParse(pdfBuffer);

        return {
            text: data.text,
            numPages: data.numpages,
            info: data.info || {}
        };
    } catch (error) {
        console.error("[PDF Service] Erro ao extrair texto do PDF:", error.message);
        throw new Error(`Falha ao processar PDF: ${error.message}`);
    }
}

/**
 * Divide texto em chunks de aproximadamente N palavras.
 * Tenta respeitar quebras de parágrafo e sentenças.
 * @param {string} text - Texto completo.
 * @param {number} targetWords - Número alvo de palavras por chunk (padrão: 500).
 * @returns {string[]} Array de chunks.
 */
function chunkText(text, targetWords = 500) {
    if (!text || text.trim().length === 0) {
        return [];
    }

    // Limpa texto: remove múltiplas quebras de linha, espaços extras
    const cleanedText = text
        .replace(/\r\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]+/g, " ")
        .trim();

    // Divide por parágrafos (dupla quebra de linha)
    const paragraphs = cleanedText.split(/\n\n+/);

    const chunks = [];
    let currentChunk = "";
    let currentWordCount = 0;

    for (const paragraph of paragraphs) {
        const paragraphWords = paragraph.split(/\s+/).filter(w => w.length > 0).length;

        // Se o parágrafo sozinho é maior que o limite, divide por sentenças
        if (paragraphWords > targetWords * 1.5) {
            // Salva chunk atual se existir
            if (currentChunk.trim()) {
                chunks.push(currentChunk.trim());
                currentChunk = "";
                currentWordCount = 0;
            }

            // Divide parágrafo grande por sentenças
            const sentences = paragraph.split(/(?<=[.!?])\s+/);
            for (const sentence of sentences) {
                const sentenceWords = sentence.split(/\s+/).filter(w => w.length > 0).length;

                if (currentWordCount + sentenceWords > targetWords && currentChunk.trim()) {
                    chunks.push(currentChunk.trim());
                    currentChunk = sentence;
                    currentWordCount = sentenceWords;
                } else {
                    currentChunk += (currentChunk ? " " : "") + sentence;
                    currentWordCount += sentenceWords;
                }
            }
        } else {
            // Parágrafo normal - adiciona ao chunk atual
            if (currentWordCount + paragraphWords > targetWords && currentChunk.trim()) {
                chunks.push(currentChunk.trim());
                currentChunk = paragraph;
                currentWordCount = paragraphWords;
            } else {
                currentChunk += (currentChunk ? "\n\n" : "") + paragraph;
                currentWordCount += paragraphWords;
            }
        }
    }

    // Adiciona último chunk se existir
    if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
    }

    return chunks;
}

/**
 * Vetoriza um PDF, salvando cada chunk como uma memória separada.
 * @param {string} chatToken - Token do chat.
 * @param {string} collectionName - Collection onde salvar (fatos, conceitos, etc).
 * @param {string} base64Data - Dados do PDF em base64.
 * @param {string} fileName - Nome original do arquivo.
 * @param {string} apiKey - API Key do Gemini para embeddings.
 * @param {function} onProgress - Callback de progresso (current, total).
 * @returns {Promise<{success: boolean, chunks: number, documentId: string}>}
 */
async function vectorizePDF(chatToken, collectionName, base64Data, fileName, apiKey, onProgress) {
    console.log(`[PDF Service] Iniciando vetorização de: ${fileName}`);

    if (!apiKey) {
        throw new Error("API Key do Gemini necessária para gerar embeddings.");
    }

    // 1. Extrai texto do PDF
    const { text, numPages, info } = await extractTextFromPDF(base64Data);

    if (!text || text.trim().length < 50) {
        throw new Error("PDF não contém texto extraível suficiente. O documento pode ser escaneado/imagem.");
    }

    console.log(`[PDF Service] Texto extraído: ${text.length} caracteres, ${numPages} páginas.`);

    // 2. Divide em chunks
    const chunks = chunkText(text, 500);

    if (chunks.length === 0) {
        throw new Error("Não foi possível dividir o texto do PDF em chunks.");
    }

    console.log(`[PDF Service] Dividido em ${chunks.length} chunks.`);

    // 3. Gera ID único para este documento (agrupa os chunks)
    const documentId = uuidv4();
    const documentTitle = info.Title || fileName;

    // 4. Processa cada chunk
    let processedCount = 0;
    const results = [];

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];

        try {
            // Gera embedding para o chunk
            const vector = await geminiService.generateEmbedding(chunk, apiKey);

            // Monta o texto com metadados
            const textWithContext = `[Documento: ${documentTitle}] [Parte ${i + 1}/${chunks.length}]\n\n${chunk}`;

            // Cria registro
            const record = {
                text: textWithContext,
                vector,
                messageid: uuidv4(),
                role: "document", // Role especial para conteúdo de documento
                createdAt: Date.now(),
                attachments: JSON.stringify([]), // Sem anexo (texto extraído)
                // Metadados do documento
                _documentId: documentId,
                _documentTitle: documentTitle,
                _chunkIndex: i + 1,
                _totalChunks: chunks.length,
                _sourceFileName: fileName
            };

            await lanceDBService.insertRecord(chatToken, collectionName, record);
            results.push(record.messageid);
            processedCount++;

            // Callback de progresso
            if (onProgress) {
                onProgress(processedCount, chunks.length);
            }

            // Pequeno delay para evitar rate limit
            if (i < chunks.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }

        } catch (error) {
            console.error(`[PDF Service] Erro no chunk ${i + 1}:`, error.message);
            // Continua com próximos chunks
        }
    }

    console.log(`[PDF Service] Vetorização concluída: ${processedCount}/${chunks.length} chunks salvos.`);

    return {
        success: true,
        documentId,
        documentTitle,
        chunks: processedCount,
        totalChunks: chunks.length,
        collection: collectionName,
        messageIds: results
    };
}

/**
 * Lista documentos vetorizados em um chat.
 * @param {string} chatToken 
 * @param {string} collectionName 
 * @returns {Promise<Array>}
 */
async function listVectorizedDocuments(chatToken, collectionName) {
    try {
        const allRecords = await lanceDBService.getAllRecordsFromCollection(chatToken, collectionName);

        // Agrupa por documentId
        const documents = {};

        for (const record of allRecords) {
            if (record._documentId) {
                if (!documents[record._documentId]) {
                    documents[record._documentId] = {
                        documentId: record._documentId,
                        title: record._documentTitle || "Documento",
                        fileName: record._sourceFileName,
                        chunks: 0,
                        totalChunks: record._totalChunks || 0,
                        createdAt: record.createdAt
                    };
                }
                documents[record._documentId].chunks++;
            }
        }

        return Object.values(documents);
    } catch (error) {
        console.error("[PDF Service] Erro ao listar documentos:", error.message);
        return [];
    }
}

/**
 * Remove um documento vetorizado (todos os chunks).
 * @param {string} chatToken 
 * @param {string} collectionName 
 * @param {string} documentId 
 * @returns {Promise<number>} Número de chunks removidos.
 */
async function deleteVectorizedDocument(chatToken, collectionName, documentId) {
    try {
        const allRecords = await lanceDBService.getAllRecordsFromCollection(chatToken, collectionName);

        let deletedCount = 0;
        for (const record of allRecords) {
            if (record._documentId === documentId) {
                await lanceDBService.deleteRecordByMessageId(chatToken, record.messageid);
                deletedCount++;
            }
        }

        console.log(`[PDF Service] Documento ${documentId} removido: ${deletedCount} chunks deletados.`);
        return deletedCount;
    } catch (error) {
        console.error("[PDF Service] Erro ao deletar documento:", error.message);
        throw error;
    }
}

module.exports = {
    extractTextFromPDF,
    chunkText,
    vectorizePDF,
    listVectorizedDocuments,
    deleteVectorizedDocument
};
