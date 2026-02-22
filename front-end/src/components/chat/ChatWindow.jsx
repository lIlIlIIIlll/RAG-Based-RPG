// src/components/ChatWindow.jsx
import React, { useRef, useState, useEffect } from "react";
import Message from "./Message.jsx";
import LoadingIndicator from "../ui/LoadingIndicator.jsx";
import FileCard from "../files/FileCard.jsx";
import PDFOptionsModal from "../files/PDFOptionsModal.jsx";
import { Send, Paperclip, Trash2, X, CheckSquare, Dice6 } from "lucide-react";
import styles from "./ChatWindow.module.css";
import { Virtuoso } from "react-virtuoso";
import { vectorizePDF } from "../../services/api.js";

const ChatWindow = ({
    messages,
    isLoading,
    onSendMessage,
    onEditMessage,
    onDeleteMessage,
    onRegenerate,
    onPreviewFile,
    onMassDelete,
    onBranch,
    chatToken
}) => {
    const [inputText, setInputText] = useState("");
    const [selectedFiles, setSelectedFiles] = useState([]);
    const [isSelectionMode, setIsSelectionMode] = useState(false);
    const [selectedMessages, setSelectedMessages] = useState(new Set());
    const [editingMessageId, setEditingMessageId] = useState(null);
    const textareaRef = useRef(null);
    const fileInputRef = useRef(null);

    // PDF Options Modal state
    const [showPdfModal, setShowPdfModal] = useState(false);
    const [pendingPdf, setPendingPdf] = useState(null);

    // Dice command history
    const [diceHistory, setDiceHistory] = useState(() => {
        const saved = localStorage.getItem('diceHistory');
        return saved ? JSON.parse(saved) : [];
    });
    const [showDiceHistory, setShowDiceHistory] = useState(false);

    // Auto-save draft to localStorage
    useEffect(() => {
        if (chatToken) {
            const draft = localStorage.getItem(`draft_${chatToken}`);
            if (draft) setInputText(draft);
        }
    }, [chatToken]);

    useEffect(() => {
        if (chatToken) {
            if (inputText) {
                localStorage.setItem(`draft_${chatToken}`, inputText);
            } else {
                localStorage.removeItem(`draft_${chatToken}`);
            }
        }
    }, [inputText, chatToken]);

    // Calculate word and token count
    const wordCount = inputText.trim() ? inputText.trim().split(/\s+/).length : 0;
    const tokenEstimate = Math.ceil(inputText.length / 4);

    // Global keyboard shortcuts
    useEffect(() => {
        const handleGlobalKeyDown = (e) => {
            // Ctrl+R - Regenerate last response
            if (e.ctrlKey && e.key === 'r') {
                e.preventDefault();
                if (!isLoading && onRegenerate) {
                    onRegenerate();
                }
            }

            // Arrow Up on empty input - Edit last message
            if (e.key === 'ArrowUp' &&
                document.activeElement === textareaRef.current &&
                inputText === '' &&
                messages.length > 0) {
                e.preventDefault();
                const lastMsg = messages[messages.length - 1];
                if (lastMsg?.messageid) {
                    setEditingMessageId(lastMsg.messageid);
                }
            }
        };

        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }, [isLoading, onRegenerate, inputText, messages, onEditMessage]);

    // Ajusta altura do textarea automaticamente
    const handleInput = (e) => {
        const target = e.target;
        target.style.height = "auto";
        target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
        setInputText(target.value);

        // Show dice history dropdown when typing /r
        setShowDiceHistory(target.value.startsWith('/r') && diceHistory.length > 0);
    };

    // Save dice command to history
    const saveDiceCommand = (command) => {
        if (command.startsWith('/r ')) {
            const newHistory = [command, ...diceHistory.filter(c => c !== command)].slice(0, 5);
            setDiceHistory(newHistory);
            localStorage.setItem('diceHistory', JSON.stringify(newHistory));
        }
    };

    const selectDiceCommand = (command) => {
        setInputText(command);
        setShowDiceHistory(false);
        textareaRef.current?.focus();
    };

    const handleFileSelect = (e) => {
        if (e.target.files && e.target.files.length > 0) {
            const newFiles = Array.from(e.target.files);

            // Verifica se há algum PDF nos arquivos selecionados
            const pdfFile = newFiles.find(f => f.type === "application/pdf");

            if (pdfFile) {
                // Se tem PDF, abre o modal de opções
                setPendingPdf(pdfFile);
                setShowPdfModal(true);

                // Adiciona os outros arquivos (não-PDFs) diretamente
                const otherFiles = newFiles.filter(f => f.type !== "application/pdf");
                if (otherFiles.length > 0) {
                    setSelectedFiles((prev) => [...prev, ...otherFiles]);
                }
            } else {
                // Se não tem PDF, adiciona diretamente
                setSelectedFiles((prev) => [...prev, ...newFiles]);
            }
        }
        // Reset input value to allow selecting same file again if needed
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    };

    // PDF Modal handlers
    const handleVectorizePdf = async (collection, onProgress) => {
        if (!pendingPdf || !chatToken) return;

        // Converte o arquivo para base64
        const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const base64String = reader.result.split(",")[1];
                resolve(base64String);
            };
            reader.onerror = reject;
            reader.readAsDataURL(pendingPdf);
        });

        const result = await vectorizePDF(chatToken, base64, pendingPdf.name, collection, onProgress);
        return result;
    };

    const handleSavePdfAsMedia = () => {
        if (pendingPdf) {
            setSelectedFiles((prev) => [...prev, pendingPdf]);
        }
    };

    const handleClosePdfModal = () => {
        setShowPdfModal(false);
        setPendingPdf(null);
    };

    const handleRemoveFile = (index) => {
        setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
    };

    // --- Selection Mode Handlers ---

    const toggleSelectionMode = () => {
        setIsSelectionMode(!isSelectionMode);
        setSelectedMessages(new Set());
    };

    const handleSelectMessage = (messageId) => {
        const newSelected = new Set(selectedMessages);
        if (newSelected.has(messageId)) {
            newSelected.delete(messageId);
        } else {
            newSelected.add(messageId);
        }
        setSelectedMessages(newSelected);
    };

    const executeMassDelete = () => {
        if (selectedMessages.size === 0) return;

        // Encontra os objetos de mensagem completos para os IDs selecionados
        const messagesToDelete = messages.filter(msg => selectedMessages.has(msg.messageid));

        onMassDelete(messagesToDelete);

        // Opcional: Limpar seleção aqui ou esperar o pai atualizar?
        // Vamos limpar para dar feedback imediato de que a ação foi solicitada
        setIsSelectionMode(false);
        setSelectedMessages(new Set());
    };

    const handleFormSubmit = (event) => {
        event.preventDefault();
        const trimmedText = inputText.trim();
        if ((trimmedText || selectedFiles.length > 0) && !isLoading) {
            // Save dice command to history
            saveDiceCommand(trimmedText);

            onSendMessage(trimmedText, selectedFiles);
            setInputText("");
            setSelectedFiles([]);
            setShowDiceHistory(false);
            if (textareaRef.current) textareaRef.current.style.height = "auto";
        }
    };

    const handleKeyDown = (event) => {
        if (event.key === "Enter") {
            if (event.shiftKey) {
                event.preventDefault();
                const start = event.target.selectionStart;
                const end = event.target.selectionEnd;
                const value = inputText;
                const newValue = value.substring(0, start) + "\n" + value.substring(end);

                setInputText(newValue);

                // Ajusta cursor e altura após renderização
                setTimeout(() => {
                    const target = textareaRef.current;
                    if (target) {
                        target.selectionStart = target.selectionEnd = start + 1;
                        target.style.height = "auto";
                        target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
                    }
                }, 0);
            } else {
                event.preventDefault();
                handleFormSubmit(event);
            }
        }
    };

    const handlePaste = (e) => {
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf("image") === 0) {
                const blob = items[i].getAsFile();
                setSelectedFiles((prev) => [...prev, blob]);
                e.preventDefault();
            }
        }
    };

    return (
        <div className={styles.chatWindow}>
            {/* PDF Options Modal */}
            <PDFOptionsModal
                isOpen={showPdfModal}
                fileName={pendingPdf?.name || ""}
                onClose={handleClosePdfModal}
                onVectorize={handleVectorizePdf}
                onSaveAsMedia={handleSavePdfAsMedia}
            />

            {/* Selection Toolbar */}
            {isSelectionMode && (
                <div className={styles.selectionToolbar}>
                    <div className={styles.selectionInfo}>
                        <span className={styles.selectionCount}>{selectedMessages.size} selecionadas</span>
                    </div>
                    <div className={styles.selectionActions}>
                        <button onClick={toggleSelectionMode} className={styles.cancelSelectionBtn}>
                            <X size={18} />
                            Cancelar
                        </button>
                        <button
                            onClick={executeMassDelete}
                            className={styles.deleteSelectionBtn}
                            disabled={selectedMessages.size === 0}
                        >
                            <Trash2 size={18} />
                            Deletar
                        </button>
                    </div>
                </div>
            )}

            {!isSelectionMode && messages.length > 0 && (
                <button
                    className={styles.enterSelectionModeBtn}
                    onClick={toggleSelectionMode}
                    title="Selecionar mensagens"
                >
                    <CheckSquare size={20} />
                </button>
            )}

            <div className={styles.messageList} style={{ display: 'block', overflowY: 'auto', overflowX: 'visible', padding: 0 }}>
                {messages.length === 0 ? (
                    <div className={styles.emptyState} style={{ height: '100%' }}>
                        <h2>O que vamos jogar hoje?</h2>
                        <p>Este chat possui memória dinâmica e upload de arquivos</p>
                    </div>
                ) : (
                    <Virtuoso
                        style={{ height: "100%", width: "100%", overflowX: 'hidden' }}
                        data={messages}
                        initialTopMostItemIndex={messages.length - 1}
                        followOutput="smooth"
                        itemContent={(index, msg) => (
                            <div className={styles.messageItemWrapper}>
                                <Message
                                    key={msg.messageid || index}
                                    msg={msg}
                                    isLast={index === messages.length - 1}
                                    onEdit={onEditMessage}
                                    onDelete={onDeleteMessage}
                                    onRegenerate={onRegenerate}
                                    onPreviewFile={onPreviewFile}
                                    isSelectionMode={isSelectionMode}
                                    isSelected={selectedMessages.has(msg.messageid)}
                                    onToggleSelection={() => handleSelectMessage(msg.messageid)}
                                    onBranch={onBranch}
                                    forceEditMode={editingMessageId === msg.messageid}
                                    onEditModeChange={(isEditing) => {
                                        if (!isEditing) setEditingMessageId(null);
                                    }}
                                />
                            </div>
                        )}
                        components={{
                            Header: () => <div style={{ height: "40px" }} />,
                            Footer: () => (
                                <div style={{ paddingBottom: "20px", paddingLeft: "40px", paddingRight: "40px" }}>
                                    {isLoading && (
                                        <div className={styles.loadingContainer}>
                                            <div className={styles.typingIndicator}>
                                                <div className={styles.magicOrb}>
                                                    <div className={styles.orbCore}></div>
                                                    <div className={styles.orbRing}></div>
                                                    <div className={styles.orbParticles}>
                                                        <span></span><span></span><span></span><span></span>
                                                    </div>
                                                </div>
                                                <div className={styles.typingText}>
                                                    <span className={styles.typingLabel}>O Mestre está conjurando sua narração</span>
                                                    <span className={styles.typingDots}></span>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ),
                        }}
                    />
                )}
            </div>

            <div className={styles.inputArea}>
                {selectedFiles.length > 0 && (
                    <div className={styles.fileList}>
                        {selectedFiles.map((file, index) => (
                            <FileCard
                                key={index}
                                fileName={file.name}
                                fileType={file.type}
                                onRemove={() => handleRemoveFile(index)}
                                onClick={() => {
                                    // Para arquivos locais (upload), criamos uma URL temporária para preview
                                    const tempUrl = URL.createObjectURL(file);
                                    onPreviewFile({
                                        name: file.name,
                                        type: file.type,
                                        url: tempUrl,
                                        content: null // Não lemos o conteúdo aqui para simplificar
                                    });
                                }}
                            />
                        ))}
                    </div>
                )}

                <form onSubmit={handleFormSubmit} className={styles.inputForm}>
                    <input
                        type="file"
                        multiple
                        ref={fileInputRef}
                        style={{ display: "none" }}
                        onChange={handleFileSelect}
                        accept=".pdf,.txt,.png,.jpg,.jpeg,.webp"
                    />
                    <button
                        type="button"
                        className={styles.attachButton}
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isLoading}
                        title="Anexar arquivos (PDF, TXT, Imagens)"
                    >
                        <Paperclip size={20} />
                    </button>

                    <textarea
                        ref={textareaRef}
                        value={inputText}
                        onChange={handleInput}
                        onKeyDown={handleKeyDown}
                        onPaste={handlePaste}
                        className={styles.textInput}
                        placeholder="Faça sua ação..."
                        rows={1}
                        disabled={isLoading}
                    />
                    <button
                        type="submit"
                        className={styles.sendButton}
                        disabled={isLoading || (!inputText.trim() && selectedFiles.length === 0)}
                    >
                        <Send size={20} />
                    </button>

                    {/* Dice History Dropdown */}
                    {showDiceHistory && (
                        <div className={styles.diceHistoryDropdown}>
                            <div className={styles.diceHistoryHeader}>
                                <Dice6 size={14} />
                                <span>Histórico de dados</span>
                            </div>
                            {diceHistory.map((cmd, i) => (
                                <button
                                    key={i}
                                    type="button"
                                    className={styles.diceHistoryItem}
                                    onClick={() => selectDiceCommand(cmd)}
                                >
                                    {cmd}
                                </button>
                            ))}
                        </div>
                    )}
                </form>
                <div className={styles.footerNote}>
                    <span>Enter para enviar / Shift+Enter para quebrar linha</span>
                    {inputText.length > 0 && (
                        <span className={styles.inputStats}>
                            {wordCount} palavras · ~{tokenEstimate} tokens
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ChatWindow;