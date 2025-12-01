// src/components/ChatWindow.jsx
import React, { useRef, useState } from "react";
import Message from "./Message.jsx";
import LoadingIndicator from "./LoadingIndicator.jsx";
import FileCard from "./FileCard.jsx";
import { Send, Paperclip, Trash2, X, CheckSquare } from "lucide-react";
import styles from "./ChatWindow.module.css";
import { Virtuoso } from "react-virtuoso";

const ChatWindow = ({
    messages,
    isLoading,
    onSendMessage,
    onEditMessage,
    onDeleteMessage,
    onRegenerate,
    onPreviewFile,
    onMassDelete,
    onBranch
}) => {
    const [inputText, setInputText] = useState("");
    const [selectedFiles, setSelectedFiles] = useState([]);
    const [isSelectionMode, setIsSelectionMode] = useState(false);
    const [selectedMessages, setSelectedMessages] = useState(new Set());
    const textareaRef = useRef(null);
    const fileInputRef = useRef(null);

    // Ajusta altura do textarea automaticamente
    const handleInput = (e) => {
        const target = e.target;
        target.style.height = "auto";
        target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
        setInputText(target.value);
    };

    const handleFileSelect = (e) => {
        if (e.target.files && e.target.files.length > 0) {
            const newFiles = Array.from(e.target.files);
            setSelectedFiles((prev) => [...prev, ...newFiles]);
        }
        // Reset input value to allow selecting same file again if needed
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
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
            onSendMessage(trimmedText, selectedFiles);
            setInputText("");
            setSelectedFiles([]);
            if (textareaRef.current) textareaRef.current.style.height = "auto";
        }
    };

    const handleKeyDown = (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            handleFormSubmit(event);
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

            <div className={styles.messageList} style={{ display: 'block', overflow: 'hidden', padding: 0 }}>
                {messages.length === 0 ? (
                    <div className={styles.emptyState} style={{ height: '100%' }}>
                        <h2>O que vamos jogar hoje?</h2>
                        <p>Este chat possui memória dinâmica e upload de arquivos</p>
                    </div>
                ) : (
                    <Virtuoso
                        style={{ height: "100%", width: "100%" }}
                        data={messages}
                        initialTopMostItemIndex={messages.length - 1}
                        followOutput="smooth"
                        itemContent={(index, msg) => (
                            <div style={{ padding: "0 40px 24px 40px" }}>
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
                                />
                            </div>
                        )}
                        components={{
                            Header: () => <div style={{ height: "40px" }} />,
                            Footer: () => (
                                <div style={{ paddingBottom: "120px", paddingLeft: "40px", paddingRight: "40px" }}>
                                    {isLoading && (
                                        <div className={styles.loadingContainer}>
                                            <LoadingIndicator />
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
                        placeholder="Envie uma mensagem..."
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
                </form>
                <div className={styles.footerNote}>
                    IA pode cometer erros. Verifique informações importantes.
                </div>
            </div>
        </div>
    );
};

export default ChatWindow;