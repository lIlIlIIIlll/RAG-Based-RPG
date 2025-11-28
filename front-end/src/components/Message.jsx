// src/components/Message.jsx
import React, { useState, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { User, Bot, Copy, Edit2, Trash2, RefreshCw, Check } from "lucide-react";
import FileCard from "./FileCard.jsx";
import DiceResult from "./DiceResult.jsx";
import styles from "./Message.module.css";

const Message = ({
  msg,
  isLast,
  onEdit,
  onDelete,
  onRegenerate,
  onPreviewFile
}) => {
  const { role, text, messageid, attachments } = msg;
  const isUser = role === "user";
  const [isHovered, setIsHovered] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(text);
  const [copied, setCopied] = useState(false);

  // Extrai arquivos do texto e limpa o texto para exibição
  const { cleanText, files } = useMemo(() => {
    const fileRegex = /\[Arquivo: (.*?)\]/g;
    const foundFiles = [];
    let match;

    // Encontra todos os arquivos
    while ((match = fileRegex.exec(text)) !== null) {
      foundFiles.push(match[1]);
    }

    // Remove as linhas de arquivo do texto para exibição
    // Remove também quebras de linha extras que possam ter ficado
    const newText = text.replace(fileRegex, "").trim();

    return { cleanText: newText, files: foundFiles };
  }, [text]);

  // Parse attachments from message object (for generated images)
  const parsedAttachments = useMemo(() => {
    if (!attachments) return [];
    try {
      return typeof attachments === 'string' ? JSON.parse(attachments) : attachments;
    } catch (e) {
      return [];
    }
  }, [attachments]);

  const isDiceRoll = useMemo(() => {
    return /^(.*?) = (.*?) \{ (.*?) \}$/.test(cleanText);
  }, [cleanText]);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveEdit = () => {
    if (editText.trim() !== text) {
      onEdit(messageid, editText);
    }
    setIsEditing(false);
  };

  return (
    <div
      className={`${styles.messageRow} ${isUser ? styles.userRow : styles.botRow}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className={styles.avatar}>
        {isUser ? <User size={18} /> : <Bot size={18} />}
      </div>

      <div className={styles.contentWrapper}>
        <div className={styles.bubble}>
          {/* Arquivos enviados pelo usuário */}
          {files.length > 0 && !isEditing && (
            <div className={styles.fileAttachments}>
              {files.map((fileName, index) => (
                <FileCard
                  key={index}
                  fileName={fileName}
                  onClick={() => {
                    // Para arquivos já enviados, construímos a URL baseada no backend
                    // Assumindo que o backend serve arquivos estáticos ou tem uma rota de download
                    // Se não tiver, o preview pode falhar ou precisar de ajuste
                    const baseUrl = "http://localhost:3001/uploads"; // Ajuste conforme sua configuração
                    const fileUrl = `${baseUrl}/${fileName}`;

                    if (onPreviewFile) {
                      onPreviewFile({
                        name: fileName,
                        type: fileName.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg', // Inferência simples
                        url: fileUrl,
                        content: null
                      });
                    }
                  }}
                />
              ))}
            </div>
          )}

          {/* Imagens geradas pelo modelo */}
          {parsedAttachments.length > 0 && (
            <div className={styles.generatedImages}>
              {parsedAttachments.map((att, index) => (
                att.mimeType.startsWith('image/') ? (
                  <img
                    key={index}
                    src={`data:${att.mimeType};base64,${att.data}`}
                    alt="Generated"
                    className={styles.generatedImage}
                    onClick={() => onPreviewFile && onPreviewFile({
                      name: `generated_${index}.png`,
                      type: att.mimeType,
                      url: `data:${att.mimeType};base64,${att.data}`,
                      content: null
                    })}
                  />
                ) : null
              ))}
            </div>
          )}

          {isEditing ? (
            <div className={styles.editContainer}>
              <textarea
                className={styles.editTextarea}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                autoFocus
              />
              <div className={styles.editActions}>
                <button onClick={() => setIsEditing(false)} className={styles.cancelBtn}>Cancelar</button>
                <button onClick={handleSaveEdit} className={styles.saveBtn}>Salvar</button>
              </div>
            </div>
          ) : (
            <div className={styles.markdownBody}>
              {isDiceRoll ? (
                <DiceResult resultString={cleanText} />
              ) : (
                <ReactMarkdown>{cleanText}</ReactMarkdown>
              )}
            </div>
          )}
        </div>

        {/* Menu de Ações (Visível no Hover via CSS) */}
        {!isEditing && (
          <div className={styles.actions}>
            <button onClick={handleCopy} title="Copiar">
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>

            {/* Só permite editar/deletar se tiver ID (mensagens persistidas) */}
            {messageid && (
              <>
                <button onClick={() => setIsEditing(true)} title="Editar">
                  <Edit2 size={14} />
                </button>
                <button onClick={() => onDelete(messageid)} title="Deletar">
                  <Trash2 size={14} />
                </button>
              </>
            )}

            {/* Botão Regenerar apenas para última mensagem do BOT */}
            {!isUser && isLast && onRegenerate && (
              <button onClick={onRegenerate} title="Regenerar Resposta">
                <RefreshCw size={14} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Message;