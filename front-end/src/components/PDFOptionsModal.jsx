// src/components/PDFOptionsModal.jsx
// Modal para escolher como processar um PDF: vetorizar ou salvar como mídia

import React, { useState } from "react";
import { FileText, Database, Image, X, Loader, CheckCircle, AlertCircle } from "lucide-react";
import styles from "./PDFOptionsModal.module.css";

const PDFOptionsModal = ({
    isOpen,
    fileName,
    onClose,
    onVectorize,
    onSaveAsMedia
}) => {
    const [selectedOption, setSelectedOption] = useState("vectorize");
    const [selectedCollection, setSelectedCollection] = useState("fatos");
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState({ current: 0, total: 0 });
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);

    if (!isOpen) return null;

    const handleConfirm = async () => {
        if (selectedOption === "vectorize") {
            setIsProcessing(true);
            setError(null);
            setResult(null);

            try {
                const vectorResult = await onVectorize(selectedCollection, (current, total) => {
                    setProgress({ current, total });
                });
                setResult(vectorResult);
            } catch (err) {
                setError(err.message || "Erro ao vetorizar PDF.");
            } finally {
                setIsProcessing(false);
            }
        } else {
            onSaveAsMedia();
            onClose();
        }
    };

    const handleClose = () => {
        if (!isProcessing) {
            setResult(null);
            setError(null);
            setProgress({ current: 0, total: 0 });
            onClose();
        }
    };

    const progressPercent = progress.total > 0
        ? Math.round((progress.current / progress.total) * 100)
        : 0;

    return (
        <div className={styles.overlay} onClick={handleClose}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                <button className={styles.closeButton} onClick={handleClose} disabled={isProcessing}>
                    <X size={20} />
                </button>

                <div className={styles.header}>
                    <FileText size={32} className={styles.headerIcon} />
                    <h2>Processar PDF</h2>
                    <p className={styles.fileName}>{fileName}</p>
                </div>

                {!isProcessing && !result && !error && (
                    <>
                        <div className={styles.options}>
                            <button
                                className={`${styles.optionCard} ${selectedOption === "vectorize" ? styles.selected : ""}`}
                                onClick={() => setSelectedOption("vectorize")}
                            >
                                <Database size={24} />
                                <div className={styles.optionContent}>
                                    <h3>Vetorizar Conteúdo</h3>
                                    <p>Extrai texto e indexa para busca semântica. Ideal para livros de regras, lore e documentos longos.</p>
                                </div>
                            </button>

                            <button
                                className={`${styles.optionCard} ${selectedOption === "media" ? styles.selected : ""}`}
                                onClick={() => setSelectedOption("media")}
                            >
                                <Image size={24} />
                                <div className={styles.optionContent}>
                                    <h3>Salvar como Mídia</h3>
                                    <p>Anexa o PDF à mensagem. Ideal para fichas visuais, mapas e documentos curtos.</p>
                                </div>
                            </button>
                        </div>

                        {selectedOption === "vectorize" && (
                            <div className={styles.collectionSelect}>
                                <label>Salvar em:</label>
                                <select
                                    value={selectedCollection}
                                    onChange={(e) => setSelectedCollection(e.target.value)}
                                >
                                    <option value="fatos">📜 Fatos</option>
                                    <option value="conceitos">💡 Conceitos</option>
                                    <option value="historico">📖 Histórico</option>
                                </select>
                            </div>
                        )}

                        <div className={styles.actions}>
                            <button className={styles.cancelButton} onClick={handleClose}>
                                Cancelar
                            </button>
                            <button className={styles.confirmButton} onClick={handleConfirm}>
                                {selectedOption === "vectorize" ? "Vetorizar" : "Anexar"}
                            </button>
                        </div>
                    </>
                )}

                {isProcessing && (
                    <div className={styles.processingState}>
                        <Loader size={40} className={styles.spinner} />
                        <h3>Vetorizando documento...</h3>
                        <div className={styles.progressBar}>
                            <div
                                className={styles.progressFill}
                                style={{ width: `${progressPercent}%` }}
                            />
                        </div>
                        <p className={styles.progressText}>
                            {progress.current} / {progress.total} chunks processados ({progressPercent}%)
                        </p>
                    </div>
                )}

                {result && (
                    <div className={styles.resultState}>
                        <CheckCircle size={48} className={styles.successIcon} />
                        <h3>Vetorização Concluída!</h3>
                        <div className={styles.resultDetails}>
                            <p><strong>{result.chunks}</strong> chunks criados</p>
                            <p>Salvos em: <strong>{selectedCollection}</strong></p>
                        </div>
                        <button className={styles.confirmButton} onClick={handleClose}>
                            Fechar
                        </button>
                    </div>
                )}

                {error && (
                    <div className={styles.errorState}>
                        <AlertCircle size={48} className={styles.errorIcon} />
                        <h3>Erro na Vetorização</h3>
                        <p className={styles.errorMessage}>{error}</p>
                        <div className={styles.actions}>
                            <button className={styles.cancelButton} onClick={handleClose}>
                                Fechar
                            </button>
                            <button className={styles.confirmButton} onClick={() => {
                                setError(null);
                                setResult(null);
                            }}>
                                Tentar Novamente
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default PDFOptionsModal;
