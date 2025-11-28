// src/components/MemoryPanel.jsx
import React, { useState, useEffect } from "react";
import {
  Search, Plus, Edit2, Save, X, Trash2,
  Database, Brain, History, ChevronRight, ChevronLeft
} from "lucide-react";
import { addMemory, editMemory, searchMemory, deleteMessage } from "../services/api";
import { useToast } from "../context/ToastContext";
import { useConfirmation } from "../context/ConfirmationContext";
import styles from "./MemoryPanel.module.css";

const MemoryPanel = ({ chatToken, vectorMemory }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState("historico");
  const [localVectorMemory, setLocalVectorMemory] = useState(vectorMemory || []);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  // Estado do Modal de Adição
  const [showAddModal, setShowAddModal] = useState(false);
  const [newMemoryText, setNewMemoryText] = useState("");
  const [isSavingMemory, setIsSavingMemory] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const { addToast } = useToast();
  const { confirm } = useConfirmation();

  useEffect(() => {
    setLocalVectorMemory(vectorMemory || []);
  }, [vectorMemory]);

  const collections = [
    { id: "historico", label: "Histórico", icon: <History size={14} /> },
    { id: "fatos", label: "Fatos", icon: <Database size={14} /> },
    { id: "conceitos", label: "Conceitos", icon: <Brain size={14} /> },
  ];

  // --- Ações ---

  const handleSearch = async (e) => {
    const query = e ? e.target.value : searchQuery;
    setSearchQuery(query);

    if (!query.trim() || !chatToken) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const results = await searchMemory(chatToken, activeTab, query);
      setSearchResults(results || []);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleAddMemory = async () => {
    const text = newMemoryText.trim();
    if (!text || !chatToken) return;

    setIsSavingMemory(true);
    try {
      // Usa a aba ativa como coleção alvo
      await addMemory(chatToken, activeTab, text);
      addToast({ type: "success", message: `Adicionado a ${activeTab}.` });
      setNewMemoryText("");
      setShowAddModal(false);
    } catch (err) {
      addToast({ type: "error", message: "Erro ao salvar memória." });
    } finally {
      setIsSavingMemory(false);
    }
  };

  const handleDeleteMemory = async (id) => {
    if (!(await confirm("Remover esta memória permanentemente?", "Confirmar Exclusão"))) return;
    try {
      await deleteMessage(chatToken, id);

      const filter = (list) => list.filter(m => m.messageid !== id);
      setLocalVectorMemory(prev => filter(prev));
      setSearchResults(prev => filter(prev));

      addToast({ type: "success", message: "Memória removida." });
    } catch (err) {
      addToast({ type: "error", message: "Erro ao remover memória." });
    }
  };

  const startEditing = (item) => {
    setEditingId(item.messageid);
    setEditingText(item.text);
  };

  const handleSaveEdit = async () => {
    if (!editingText.trim() || !editingId) return;
    setIsSavingEdit(true);
    try {
      await editMemory(chatToken, editingId, editingText);

      const update = (list) => list.map(m => m.messageid === editingId ? { ...m, text: editingText } : m);
      setLocalVectorMemory(prev => update(prev));
      setSearchResults(prev => update(prev));

      addToast({ type: "success", message: "Memória atualizada." });
      setEditingId(null);
    } catch (err) {
      addToast({ type: "error", message: "Erro ao editar memória." });
    } finally {
      setIsSavingEdit(false);
    }
  };

  const listToRender = searchQuery.trim().length > 0
    ? searchResults
    : localVectorMemory.filter(item => item.category === activeTab);

  return (
    <div className={`${styles.memoryPanelContainer} ${collapsed ? styles.collapsed : ""}`}>

      {/* Botão Toggle Lateral (Fora do wrapper para ficar visível quando colapsado) */}
      <button
        className={styles.collapseButton}
        onClick={() => setCollapsed(!collapsed)}
        title={collapsed ? "Expandir Memória" : "Ocultar Memória"}
      >
        {collapsed ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
      </button>

      {/* Conteúdo Interno (Escondido quando colapsado) */}
      <div className={styles.panelContentWrapper}>
        <div className={styles.header}>
          <div className={styles.headerTop}>
            <h3>
              <Brain size={16} color="var(--accent-primary)" />
              Memória RAG
            </h3>

            {/* Botão de Adicionar (Sempre renderizado, mas invisível em Histórico) */}
            <button
              className={`${styles.addBtnHeader} ${activeTab === 'historico' ? styles.hidden : ''}`}
              onClick={() => activeTab !== 'historico' && setShowAddModal(true)}
              title={activeTab !== 'historico' ? `Adicionar em ${activeTab}` : ''}
              disabled={activeTab === 'historico'}
            >
              <Plus size={16} />
            </button>
          </div>

          <div className={styles.tabs}>
            {collections.map((c) => (
              <button
                key={c.id}
                className={`${styles.tab} ${activeTab === c.id ? styles.active : ""}`}
                onClick={() => {
                  setActiveTab(c.id);
                  setSearchQuery("");
                  setSearchResults([]);
                }}
              >
                {c.icon}
                <span>{c.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className={styles.searchBar}>
          <Search size={14} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            value={searchQuery}
            onChange={handleSearch}
            placeholder={`Buscar em ${activeTab}...`}
          />
        </div>

        <div className={styles.content}>
          {listToRender.length === 0 ? (
            <div className={styles.emptyMessage}>
              {searchQuery
                ? "Nenhum resultado encontrado."
                : "Nenhuma memória relevante recuperada."}
            </div>
          ) : (
            // Agrupa por categoria
            Object.entries(
              listToRender.reduce((acc, item) => {
                const cat = item.category || "outros";
                if (!acc[cat]) acc[cat] = [];
                acc[cat].push(item);
                return acc;
              }, {})
            ).map(([category, items]) => {
              const collectionInfo = collections.find(c => c.id === category) || { label: category, icon: <Database size={14} /> };

              return (
                <div key={category} className={styles.categorySection}>
                  <div className={styles.categoryHeader}>
                    {collectionInfo.icon}
                    <span>{collectionInfo.label}</span>
                  </div>

                  {items.map((item, index) => {
                    const isEditing = item.messageid === editingId;
                    return (
                      <div key={item.messageid || index} className={styles.memoryItem}>
                        {isEditing ? (
                          <div className={styles.editContainer}>
                            <textarea
                              className={styles.editInput}
                              value={editingText}
                              onChange={(e) => setEditingText(e.target.value)}
                            />
                            <div className={styles.editButtons}>
                              <button onClick={() => setEditingId(null)} className={styles.actionBtn}>
                                <X size={14} />
                              </button>
                              <button
                                onClick={handleSaveEdit}
                                className={styles.actionBtn}
                                style={{ color: 'var(--accent-primary)' }}
                                disabled={isSavingEdit}
                              >
                                <Save size={14} />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className={styles.memoryText}>{item.text}</p>
                            <div className={styles.memoryMeta}>
                              {item._score != null && (
                                <span className={styles.scoreTag}>
                                  {(item._score * 100).toFixed(0)}%
                                </span>
                              )}

                              {item.messageid && (
                                <div className={styles.itemActions}>
                                  <button
                                    onClick={() => startEditing(item)}
                                    className={styles.actionBtn}
                                    title="Editar"
                                  >
                                    <Edit2 size={12} />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteMemory(item.messageid)}
                                    className={`${styles.actionBtn} ${styles.delete}`}
                                    title="Remover"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Modal de Adição (Overlay Local) */}
      {showAddModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h4>Adicionar em {activeTab}</h4>
              <button onClick={() => setShowAddModal(false)} className={styles.modalCloseBtn}>
                <X size={16} />
              </button>
            </div>

            <textarea
              className={styles.modalTextarea}
              placeholder="Digite a nova informação..."
              value={newMemoryText}
              onChange={(e) => setNewMemoryText(e.target.value)}
              autoFocus
            />

            <div className={styles.modalFooter}>
              <button
                className={styles.modalSaveBtn}
                onClick={handleAddMemory}
                disabled={!newMemoryText.trim() || isSavingMemory}
              >
                {isSavingMemory ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MemoryPanel;