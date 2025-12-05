// src/components/ChatView.jsx
import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import ChatWindow from "./ChatWindow.jsx";
import MemoryPanel from "./MemoryPanel.jsx";
import FilePreviewModal from "./FilePreviewModal.jsx";
import log from "../services/logger.js";
import {
  generateChatResponse,
  editMemory,
  deleteMessage,
  getChatHistory,
  apiClient,
  deleteMemories,
  branchChat
} from "../services/api.js";
import ConfirmationModal from "./ConfirmationModal.jsx";
import { useToast } from "../context/ToastContext";
import { useConfirmation } from "../context/ConfirmationContext";
import styles from "./ChatView.module.css";
import DiceAnimation from "./DiceAnimation.jsx";
import { parseDiceCommand, rollDice, formatDiceResult, findAndParseDiceCommand } from "../utils/dice.js";

const ChatView = ({ chatToken }) => {
  const [messages, setMessages] = useState([]);
  const [vectorMemory, setVectorMemory] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { confirm } = useConfirmation();
  const [diceAnimationData, setDiceAnimationData] = useState(null);
  const [pendingDeletions, setPendingDeletions] = useState(null);
  const [isConfirmationModalOpen, setIsConfirmationModalOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);

  // Carrega histórico ao montar ou trocar de chat
  useEffect(() => {
    const loadHistory = async () => {
      if (!chatToken) return;

      setIsLoading(true);
      setVectorMemory([]); // Limpa memória da sessão anterior

      try {
        const historyData = await getChatHistory(chatToken);

        // O LanceDB retorna objetos completos. Mapeamos para o formato da UI.
        const formattedMessages = historyData.map(record => ({
          role: record.role || "user",
          text: record.text,
          messageid: record.messageid
        }));

        setMessages(formattedMessages);
      } catch (err) {
        console.error("Erro ao carregar histórico:", err);
        addToast({
          type: "error",
          message: "Não foi possível carregar o histórico deste chat.",
        });
      } finally {
        setIsLoading(false);
      }
    };

    loadHistory();
  }, [chatToken, addToast]);

  const handleSendMessage = async (userMessage, files = []) => {
    // Check for dice command
    if (userMessage.startsWith('/r ')) {
      const commandData = parseDiceCommand(userMessage);

      if (commandData) {
        const result = rollDice(commandData.count, commandData.type);
        const resultString = formatDiceResult(
          commandData.count,
          commandData.type,
          commandData.modifier,
          result.total,
          result.rolls
        );

        // Trigger Animation
        setDiceAnimationData({ ...commandData, ...result });

        // Send the RESULT string instead of the command
        userMessage = resultString;
      }
    }

    log("CHAT", `Usuário enviou: "${userMessage}" com ${files.length} arquivos`);
    setIsLoading(true);

    // Adiciona mensagem do usuário otimista (com ID temporário)
    const tempId = crypto.randomUUID();
    let displayText = userMessage;
    if (files.length > 0) {
      const fileNames = files.map(f => `[Arquivo: ${f.name}]`).join("\n");
      if (displayText) {
        displayText += `\n\n${fileNames}`;
      } else {
        displayText = fileNames;
      }
    }

    const newUserMessage = { role: "user", text: displayText, messageid: tempId };
    setMessages((prev) => [...prev, newUserMessage]);

    try {
      const response = await generateChatResponse(
        chatToken,
        displayText,
        vectorMemory,
        files
      );

      log("CHAT", "Resposta da IA processada com sucesso.");

      // O backend agora retorna o histórico atualizado.
      // Precisamos identificar quais mensagens são NOVAS para verificar se há dados rolados.
      // Se olharmos apenas as últimas 5 do histórico completo, podemos pegar uma rolagem antiga
      // e re-animar sem querer (bug relatado).

      const newHistory = response.history;

      // IDs que já conhecíamos antes dessa requisição (estado 'messages' no momento do envio)
      const knownIds = new Set(messages.map(m => m.messageid));
      // Adiciona o ID temporário também, para garantir
      knownIds.add(tempId);

      // Filtra apenas as mensagens que não estavam no estado anterior
      const newlyAddedMessages = newHistory.filter(m => !knownIds.has(m.messageid));

      let animationTriggered = false;

      // Itera sobre as novas mensagens (de trás para frente para pegar a mais recente se houver múltiplas)
      for (let i = newlyAddedMessages.length - 1; i >= 0; i--) {
        const msg = newlyAddedMessages[i];
        if (msg.role === 'model' && !animationTriggered) {
          // Verifica se é formato de dado: "1d20 = 20 { 20 }"
          const diceRegex = /^(\d+)d([Ff]|\d+)([\+\-]\d+)? = (-?\d+) \{ (.*?) \}$/;
          const match = msg.text.match(diceRegex);

          if (match) {
            // Parse para animation data
            const count = parseInt(match[1], 10);
            const type = match[2].toUpperCase();
            const modifier = match[3] ? parseInt(match[3], 10) : 0;
            const total = parseInt(match[4], 10);

            const rollsStr = match[5];
            const rollsValues = rollsStr.split(',').map(s => s.trim());

            // Recriar estrutura de rolls para animação
            const rolls = rollsValues.map(v => {
              let val;
              if (v === '+' || v === '-' || v === ' ') {
                val = 0; // Valor numérico fictício para Fudge
              } else {
                val = parseInt(v, 10);
              }
              return { value: val, display: v };
            });

            setDiceAnimationData({
              count,
              type,
              modifier,
              total,
              rolls
            });

            animationTriggered = true;
          }
        }
      }

      setMessages(prev => {
        const existingIds = new Set(prev.map(m => m.messageid));
        const uniqueNewMessages = newHistory.filter(m => !existingIds.has(m.messageid));

        // Remove mensagem otimista e adiciona novas
        const updatedPrev = prev.filter(m => m.messageid !== tempId);

        return [...updatedPrev, ...uniqueNewMessages];
      });

      console.log("[ChatView] Received newVectorMemory from API:", response.newVectorMemory);
      setVectorMemory(response.newVectorMemory || []);

      // Check for pending deletions
      if (response.pendingDeletions && response.pendingDeletions.length > 0) {
        setPendingDeletions(response.pendingDeletions);
        setIsConfirmationModalOpen(true);
      }
    } catch (err) {
      addToast({
        type: "error",
        message: "Falha ao obter resposta da IA.",
      });
      setMessages(prev => prev.filter(m => m.messageid !== tempId));
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditMessage = async (messageid, newText) => {
    try {
      // UI Otimista
      setMessages(prev => prev.map(msg =>
        msg.messageid === messageid ? { ...msg, text: newText } : msg
      ));

      await editMemory(chatToken, messageid, newText);
      addToast({ type: "success", message: "Mensagem atualizada." });
    } catch (error) {
      addToast({ type: "error", message: "Erro ao editar mensagem." });
    }
  };

  const handleDeleteMessage = async (messageid) => {
    if (!(await confirm("Excluir esta mensagem permanentemente?", "Confirmar Exclusão"))) return;

    try {
      // UI Otimista
      setMessages(prev => prev.filter(msg => msg.messageid !== messageid));

      await deleteMessage(chatToken, messageid);
      addToast({ type: "success", message: "Mensagem removida." });
    } catch (error) {
      addToast({ type: "error", message: "Erro ao remover mensagem." });
    }
  };

  const handleRegenerate = async () => {
    const lastUserMsgIndex = messages.findLastIndex(m => m.role === 'user');
    if (lastUserMsgIndex === -1) return;

    const lastUserMsg = messages[lastUserMsgIndex];

    // Identifica mensagens a serem removidas (a do usuário e todas as subsequentes)
    const messagesToRemove = messages.slice(lastUserMsgIndex);

    // Remove do backend
    for (const msg of messagesToRemove) {
      if (msg.messageid) {
        try {
          await deleteMessage(chatToken, msg.messageid);
        } catch (error) {
          console.error(`Erro ao deletar mensagem ${msg.messageid} durante regeneração:`, error);
        }
      }
    }

    setMessages(prev => prev.slice(0, lastUserMsgIndex));

    // Reenvia
    await handleSendMessage(lastUserMsg.text);
  };

  const handleConfirmDeletions = async (selectedIds) => {
    setIsConfirmationModalOpen(false);
    if (selectedIds.length === 0) return;

    try {
      await deleteMemories(chatToken, selectedIds);
      addToast({ type: "success", message: "Memórias excluídas com sucesso." });

      // Atualiza a memória vetorial removendo os itens deletados
      setVectorMemory(prev => prev.filter(m => !selectedIds.includes(m.messageid)));

      // Atualiza a lista de mensagens removendo as deletadas
      setMessages(prev => prev.filter(m => !selectedIds.includes(m.messageid)));

    } catch (error) {
      addToast({ type: "error", message: "Erro ao excluir memórias." });
    } finally {
      setPendingDeletions(null);
    }
  };

  const handlePreviewFile = (file) => {
    setPreviewFile(file);
  };

  const handleMassDelete = (messagesToDelete) => {
    setPendingDeletions(messagesToDelete);
    setIsConfirmationModalOpen(true);
  };

  const handleBranch = async (messageId) => {
    if (!(await confirm("Criar um novo chat a partir desta mensagem?", "Confirmar Branch", { variant: 'branch' }))) return;

    try {
      setIsLoading(true);
      const { chatToken: newChatToken } = await branchChat(chatToken, messageId);
      addToast({ type: "success", message: "Chat bifurcado com sucesso!" });
      navigate(`/c/${newChatToken}`);
    } catch (error) {
      console.error("Erro ao criar branch:", error);
      addToast({ type: "error", message: "Erro ao criar branch do chat." });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={styles.chatViewContainer}>
      <ChatWindow
        messages={messages}
        isLoading={isLoading}
        onSendMessage={handleSendMessage}
        onEditMessage={handleEditMessage}
        onDeleteMessage={handleDeleteMessage}
        onRegenerate={handleRegenerate}
        onPreviewFile={handlePreviewFile}
        onMassDelete={handleMassDelete}
        onBranch={handleBranch}
      />
      <MemoryPanel chatToken={chatToken} vectorMemory={vectorMemory} />

      {previewFile && (
        <FilePreviewModal
          file={previewFile}
          onClose={() => setPreviewFile(null)}
        />
      )}

      {diceAnimationData && (
        <DiceAnimation
          rollData={diceAnimationData}
          onComplete={() => setDiceAnimationData(null)}
        />
      )}

      <ConfirmationModal
        isOpen={isConfirmationModalOpen}
        onClose={() => setIsConfirmationModalOpen(false)}
        onConfirm={handleConfirmDeletions}
        pendingDeletions={pendingDeletions}
      />
    </div>
  );
};

export default ChatView;