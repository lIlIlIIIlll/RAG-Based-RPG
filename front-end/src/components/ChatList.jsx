// src/components/ChatList.jsx
import React, { useEffect, useState, useRef } from "react";
import { MessageSquare, Trash2, Plus, Settings, ChevronLeft, ChevronRight, Edit2, Check, X, LogOut, Upload } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { getAllChats, deleteChat, renameChat, importChat } from "../services/api";
import { useToast } from "../context/ToastContext";
import { useConfirmation } from "../context/ConfirmationContext";
import ConfigModal from "./ConfigModal.jsx";
import ApiKeyModal from "./ApiKeyModal.jsx";
import styles from "./ChatList.module.css";

const ChatList = ({ onSelectChat, activeChatToken, onNewChat, isCreating }) => {
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [pendingImportMessages, setPendingImportMessages] = useState([]);
  const [editingChatId, setEditingChatId] = useState(null);
  const [newTitle, setNewTitle] = useState("");
  const { addToast } = useToast();
  const { confirm } = useConfirmation();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  // Busca a lista de chats ao carregar
  const fetchChats = async () => {
    try {
      const data = await getAllChats();
      setChats(data);
    } catch (error) {
      console.error("Erro ao carregar chats:", error);
      addToast({
        type: "error",
        message: "Não foi possível carregar o histórico de conversas.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchChats();
  }, [activeChatToken]);

  const handleDelete = async (e, chatToken) => {
    e.stopPropagation();
    if (!(await confirm("Tem certeza que deseja excluir este chat permanentemente?", "Excluir Chat"))) return;

    try {
      await deleteChat(chatToken);
      setChats((prev) => prev.filter((c) => c.id !== chatToken));
      addToast({ type: "success", message: "Chat excluído com sucesso." });

      if (activeChatToken === chatToken) {
        onSelectChat(null);
      }
    } catch (error) {
      addToast({ type: "error", message: "Erro ao excluir chat." });
    }
  };

  const startEditing = (e, chat) => {
    e.stopPropagation();
    setEditingChatId(chat.id);
    setNewTitle(chat.title || "");
  };

  const cancelEditing = (e) => {
    e.stopPropagation();
    setEditingChatId(null);
    setNewTitle("");
  };

  const saveTitle = async (e, chatToken) => {
    e.stopPropagation();
    if (!newTitle.trim()) {
      addToast({ type: "warning", message: "O título não pode ser vazio." });
      return;
    }

    try {
      await renameChat(chatToken, newTitle);
      setChats((prev) =>
        prev.map((c) => (c.id === chatToken ? { ...c, title: newTitle } : c))
      );
      setEditingChatId(null);
      addToast({ type: "success", message: "Chat renomeado com sucesso." });
    } catch (error) {
      addToast({ type: "error", message: "Erro ao renomear chat." });
    }
  };

  const handleOpenConfig = () => {
    if (!activeChatToken) {
      addToast({
        type: "info",
        message: "Selecione ou crie um chat para acessar as configurações."
      });
      return;
    }
    setShowConfig(true);
  };

  const handleLogout = async () => {
    if (await confirm("Tem certeza que deseja sair?", "Sair")) {
      localStorage.removeItem("token");
      navigate("/");
    }
  };

  const handleImportClick = () => {
    fileInputRef.current.click();
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const jsonContent = JSON.parse(e.target.result);

        // Validação básica e extração de mensagens
        let messagesToImport = [];

        if (jsonContent.chunkedPrompt && jsonContent.chunkedPrompt.chunks && Array.isArray(jsonContent.chunkedPrompt.chunks)) {
          // Formato do example.txt (chunkedPrompt.chunks)
          messagesToImport = jsonContent.chunkedPrompt.chunks;
        } else if (jsonContent.chunkedPrompt && Array.isArray(jsonContent.chunkedPrompt)) {
          // Fallback caso chunkedPrompt seja direto um array (compatibilidade)
          messagesToImport = jsonContent.chunkedPrompt;
        } else if (Array.isArray(jsonContent)) {
          // Formato array direto
          messagesToImport = jsonContent;
        } else {
          console.error("Estrutura do JSON não reconhecida:", jsonContent);
          throw new Error("Formato de arquivo inválido. Estrutura de mensagens não encontrada.");
        }

        // Filtrar mensagens (ignorar isThought)
        const filteredMessages = messagesToImport.filter(msg => !msg.isThought);

        if (filteredMessages.length === 0) {
          addToast({ type: "warning", message: "Nenhuma mensagem válida encontrada para importar." });
          return;
        }

        // Salva as mensagens pendentes e abre o modal de API Key
        setPendingImportMessages(filteredMessages);
        setShowApiKeyModal(true);

      } catch (error) {
        console.error("Erro ao ler arquivo:", error);
        addToast({ type: "error", message: "Erro ao processar o arquivo. Verifique o formato." });
      } finally {
        if (fileInputRef.current) {
          fileInputRef.current.value = ""; // Reset input
        }
      }
    };
    reader.readAsText(file);
  };

  const handleConfirmImport = async (apiKey) => {
    setShowApiKeyModal(false);
    setLoading(true);
    try {
      const chatToken = await importChat(pendingImportMessages, apiKey);
      addToast({ type: "success", message: "Campanha importada com sucesso!" });

      await fetchChats();
      onSelectChat(chatToken);
    } catch (error) {
      console.error("Erro ao importar:", error);
      addToast({ type: "error", message: "Erro ao importar chat." });
    } finally {
      setLoading(false);
      setPendingImportMessages([]);
    }
  };

  return (
    <>
      <div className={`${styles.sidebar} ${collapsed ? styles.collapsed : ""} `}>
        <button
          className={styles.collapseBtn}
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? "Expandir Sidebar" : "Colapsar Sidebar"}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>

        <div className={styles.header}>
          <button
            className={styles.newChatBtn}
            onClick={onNewChat}
            disabled={isCreating}
          >
            <Plus size={20} />
            {!collapsed && <span>{isCreating ? "Criando..." : "Nova Campanha"}</span>}
          </button>

          <button
            className={styles.newChatBtn}
            onClick={handleImportClick}
            title="Importar Campanha"
            style={{ marginTop: '8px', backgroundColor: '#2a2a2a', border: '1px solid #444' }}
          >
            <Upload size={20} />
            {!collapsed && <span>Importar</span>}
          </button>
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            accept=".json"
            onChange={handleFileUpload}
          />
        </div>

        <div className={styles.listContainer}>
          {loading ? (
            <div className={styles.loading}>Carregando...</div>
          ) : chats.length === 0 ? (
            <div className={styles.emptyState}>
              {!collapsed && "Nenhum chat encontrado."}
            </div>
          ) : (
            chats.map((chat) => (
              <div
                key={chat.id}
                className={`${styles.chatItem} ${activeChatToken === chat.id ? styles.active : ""} `}
                onClick={() => onSelectChat(chat.id)}
              >
                <MessageSquare size={18} className={styles.icon} />

                {!collapsed && (
                  <div className={styles.info}>
                    {editingChatId === chat.id ? (
                      <div className={styles.editContainer} onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          value={newTitle}
                          onChange={(e) => setNewTitle(e.target.value)}
                          className={styles.editInput}
                          autoFocus
                        />
                        <button onClick={(e) => saveTitle(e, chat.id)} className={styles.saveBtn}>
                          <Check size={14} />
                        </button>
                        <button onClick={cancelEditing} className={styles.cancelBtn}>
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className={styles.title}>{chat.title || "Campanha"}</span>
                        <span className={styles.date}>
                          {chat.updatedAt
                            ? formatDistanceToNow(new Date(chat.updatedAt), { addSuffix: true, locale: ptBR })
                            : "Recente"}
                        </span>
                      </>
                    )}
                  </div>
                )}

                {!collapsed && editingChatId !== chat.id && (
                  <div className={styles.actions}>
                    <button
                      className={styles.actionBtn}
                      onClick={(e) => startEditing(e, chat)}
                      title="Renomear Campanha"
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      className={styles.deleteBtn}
                      onClick={(e) => handleDelete(e, chat.id)}
                      title="Excluir Chat"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div className={styles.footer}>
          <button
            className={styles.footerBtn}
            onClick={handleOpenConfig}
            title="Configurações"
          >
            <Settings size={20} />
            {!collapsed && <span>Configurações</span>}
          </button>
          <button
            className={styles.footerBtn}
            onClick={handleLogout}
            title="Sair"
          >
            <LogOut size={20} />
            {!collapsed && <span>Sair</span>}
          </button>
        </div>
      </div>

      {showConfig && (
        <ConfigModal
          chatToken={activeChatToken}
          onClose={() => setShowConfig(false)}
        />
      )}

      {showApiKeyModal && (
        <ApiKeyModal
          onClose={() => setShowApiKeyModal(false)}
          onConfirm={handleConfirmImport}
        />
      )}
    </>
  );
};

export default ChatList;