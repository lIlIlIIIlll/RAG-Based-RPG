// src/components/ChatWindow.jsx
import React, { useRef, useEffect, useState } from "react";
import Message from "./Message.jsx";
import LoadingIndicator from "./LoadingIndicator.jsx";
import FileCard from "./FileCard.jsx";
import { Send, Paperclip, X } from "lucide-react";
import styles from "./ChatWindow.module.css";

const ChatWindow = ({
  messages,
  isLoading,
  onSendMessage,
  onEditMessage,
  onDeleteMessage,
  onRegenerate,
  onPreviewFile
}) => {
  const [inputText, setInputText] = useState("");
  const [selectedFiles, setSelectedFiles] = useState([]);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  // Auto-scroll inteligente
  useEffect(() => {
    if (messages.length > 0 && messagesEndRef.current) {
      // block: "nearest" evita que a página inteira role se o container já estiver visível
      messagesEndRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [messages, isLoading]);

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

  return (
    <div className={styles.chatWindow}>
      <div className={styles.messageList}>
        {messages.length === 0 ? (
          <div className={styles.emptyState}>
            <h2>O que vamos jogar hoje?</h2>
            <p>Este chat possui memória dinâmica e upload de arquivos</p>
          </div>
        ) : (
          messages.map((msg, index) => (
            <Message
              key={msg.messageid || index} // Usa messageid se disponível
              msg={msg}
              isLast={index === messages.length - 1}
              onEdit={onEditMessage}
              onDelete={onDeleteMessage}
              onRegenerate={onRegenerate}
              onPreviewFile={onPreviewFile}
            />
          ))
        )}

        {isLoading && (
          <div className={styles.loadingContainer}>
            <LoadingIndicator />
          </div>
        )}

        <div ref={messagesEndRef} />
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