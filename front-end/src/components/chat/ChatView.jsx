// src/components/ChatView.jsx
import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import ChatWindow from "./ChatWindow.jsx";
import MemoryPanel from "../memory/MemoryPanel.jsx";
import FilePreviewModal from "../files/FilePreviewModal.jsx";
import log from "../../services/logger.js";
import {
  generateChatResponse,
  editMemory,
  deleteMessage,
  getChatHistory,
  apiClient,
  deleteMemories,
  branchChat
} from "../../services/api.js";
import ConfirmationModal from "../ui/ConfirmationModal.jsx";
import { useToast } from "../../context/ToastContext";
import { useConfirmation } from "../../context/ConfirmationContext";
import styles from "./ChatView.module.css";
import DiceAnimation from "../dice/DiceAnimation.jsx";
import { parseDiceCommand, rollDice, formatDiceResult, findAndParseDiceCommand } from "../../utils/dice.js";

const ChatView = ({ chatToken, memoryPanelCollapsed, onToggleMemoryPanel, memoryPanelRef }) => {
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
  const [pendingDiceResults, setPendingDiceResults] = useState([]); // Dice rolls waiting to be sent with next message

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
    // Verificar se API Key está configurada (exceto para comandos de dados locais)
    if (!userMessage.startsWith('/r ')) {
      try {
        const chatDetails = await apiClient.get(`/chat/${chatToken}`);
        const config = chatDetails.data?.config;
        if ((!config?.googleApiKeys || config.googleApiKeys.length === 0) && !config?.openrouterApiKey) {
          addToast({
            type: "warning",
            message: "Configure a API Key nas configurações antes de enviar mensagens."
          });
          return;
        }
      } catch (err) {
        // Se não conseguir verificar, permite continuar (erro será tratado na geração)
        console.warn("Não foi possível verificar a API Key:", err);
      }
    }

    // Check for dice command - dice rolls are added to history without AI response
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
        setDiceAnimationData({ ...commandData, ...result, notation: `${commandData.count}d${commandData.type}` });

        // Store dice result locally (will be sent with next message)
        setPendingDiceResults(prev => [...prev, resultString]);
        
        // Display pending dice roll in chat (local only, with special marker)
        const localDiceMessage = {
          role: "dice",
          text: resultString,
          messageid: `local_${crypto.randomUUID()}`,
          isPending: true
        };
        setMessages((prev) => [...prev, localDiceMessage]);
        log("CHAT", `Rolagem pendente: ${resultString}`);
        return; // Exit early - don't trigger AI response
      }
    }

    // Prepend pending dice results to the user message
    let finalMessage = userMessage;
    if (pendingDiceResults.length > 0) {
      const diceContext = pendingDiceResults.join('\n');
      finalMessage = `[Resultados de rolagem: ${diceContext}]\n\n${userMessage}`;
      setPendingDiceResults([]); // Clear pending dice
      
      // Remove local dice messages from UI (they'll come back from server)
      setMessages(prev => prev.filter(m => !m.isPending));
    }

    log("CHAT", `Usuário enviou: "${finalMessage}" com ${files.length} arquivos`);
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
        finalMessage, // Use finalMessage which includes pending dice results
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
      // Tenta extrair mensagem de erro estruturada do backend
      let errorMessage = "Falha ao obter resposta da IA.";
      let errorType = "error";

      if (err.response?.data) {
        const data = err.response.data;
        errorMessage = data.error || errorMessage;

        // Ajusta tipo de toast baseado no erro
        if (data.errorType === "moderation") {
          errorType = "warning";
          errorMessage = `⚠️ ${errorMessage}`;
        } else if (data.errorType === "rate_limit") {
          errorType = "warning";
        } else if (data.errorType === "privacy_policy") {
          errorType = "info";
        }
      }

      addToast({
        type: errorType,
        message: errorMessage,
      });
      setMessages(prev => prev.filter(m => m.messageid !== tempId));
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditMessage = async (messageid, newText) => {
    const originalMessages = [...messages]; // Cópia para rollback
    try {
      // UI Otimista
      setMessages(prev => prev.map(msg =>
        msg.messageid === messageid ? { ...msg, text: newText } : msg
      ));

      await editMemory(chatToken, messageid, newText);
      addToast({ type: "success", message: "Mensagem atualizada." });
    } catch (error) {
      setMessages(originalMessages); // Rollback
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
        chatToken={chatToken}
      />
      <MemoryPanel chatToken={chatToken} vectorMemory={vectorMemory} collapsed={memoryPanelCollapsed} onToggleCollapse={onToggleMemoryPanel} panelRef={memoryPanelRef} />

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