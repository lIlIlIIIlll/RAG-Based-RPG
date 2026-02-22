// src/components/MemoryPanel.jsx
import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Search, Plus, Edit2, Save, X, Trash2,
  Database, Brain, History, ChevronRight, ChevronLeft,
  Download, Upload, FileJson, CheckCircle, AlertCircle, Loader,
  Image, FileText, Wrench, Pin
} from "lucide-react";
import { apiClient, addMemory, editMemory, deleteMessage, getMemoryStats, exportMemories, importMemories, searchMemory, toggleEternalMemory } from "../../services/api";
import { useToast } from "../../context/ToastContext";
import { useConfirmation } from "../../context/ConfirmationContext";
import styles from "./MemoryPanel.module.css";

const MemoryPanel = ({ chatToken, vectorMemory, collapsed, onToggleCollapse, panelRef }) => {
  const [activeTab, setActiveTab] = useState("historico");
  const [localVectorMemory, setLocalVectorMemory] = useState(vectorMemory || []);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState(null); // null = show vectorMemory, [] or [...] = show search results
  const [isSearching, setIsSearching] = useState(false);
  const searchTimeoutRef = useRef(null);

  // Estado do Modal de Adição
  const [showAddModal, setShowAddModal] = useState(false);
  const [newMemoryText, setNewMemoryText] = useState("");
  const [isSavingMemory, setIsSavingMemory] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Estados para Export
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportCollections, setExportCollections] = useState({ fatos: true, conceitos: true, historico: false });
  const [memoryStats, setMemoryStats] = useState({});
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Estados para Import
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importData, setImportData] = useState(null);
  const [importCollections, setImportCollections] = useState({});
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const [isRepairing, setIsRepairing] = useState(false);

  // Estados para Modal de Mídia
  const [showMediaModal, setShowMediaModal] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState(null);
  const [editingMediaDescription, setEditingMediaDescription] = useState("");
  const [isSavingMediaDescription, setIsSavingMediaDescription] = useState(false);

  const fileInputRef = useRef(null);
  const tabsContainerRef = useRef(null);
  const tabRefs = useRef({});
  const [indicatorStyle, setIndicatorStyle] = useState({});

  const updateIndicator = useCallback(() => {
    const activeButton = tabRefs.current[activeTab];
    const container = tabsContainerRef.current;
    if (activeButton && container) {
      const containerRect = container.getBoundingClientRect();
      const buttonRect = activeButton.getBoundingClientRect();
      setIndicatorStyle({
        left: buttonRect.left - containerRect.left,
        width: buttonRect.width,
      });
    }
  }, [activeTab]);

  useEffect(() => {
    updateIndicator();
  }, [activeTab, updateIndicator]);

  const { addToast } = useToast();
  const { confirm } = useConfirmation();

  useEffect(() => {
    console.log("[MemoryPanel] vectorMemory updated:", vectorMemory);
    setLocalVectorMemory(vectorMemory || []);
  }, [vectorMemory]);

  const collections = [
    { id: "historico", label: "Histórico", icon: <History size={14} /> },
    { id: "fatos", label: "Fatos", icon: <Database size={14} /> },
    { id: "conceitos", label: "Conceitos", icon: <Brain size={14} /> },
  ];

  // --- Ações ---

  const handleSearch = (e) => {
    const query = e ? e.target.value : searchQuery;
    setSearchQuery(query);

    // Clear previous timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // If query is empty, show vectorMemory
    if (!query.trim()) {
      setSearchResults(null);
      setIsSearching(false);
      return;
    }

    // Debounce search API call
    setIsSearching(true);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const results = await searchMemory(chatToken, activeTab, query);
        // Add category to results for grouping
        const categorizedResults = results.map(item => ({
          ...item,
          category: activeTab
        }));
        setSearchResults(categorizedResults);
      } catch (err) {
        console.error("Search failed:", err);
        addToast({ type: "error", message: "Erro na busca." });
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300); // 300ms debounce
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

      addToast({ type: "success", message: "Memória removida." });
    } catch (err) {
      addToast({ type: "error", message: "Erro ao remover memória." });
    }
  };

  const handleToggleEternal = async (item) => {
    try {
      const result = await toggleEternalMemory(chatToken, item.messageid);
      const update = (list) =>
        list.map(m =>
          m.messageid === item.messageid
            ? { ...m, eternal: result.eternal ? "true" : null }
            : m
        );
      setLocalVectorMemory(prev => update(prev));
      addToast({
        type: "success",
        message: result.eternal
          ? "Memória fixada como permanente."
          : "Memória desmarcada como permanente.",
      });
    } catch (err) {
      addToast({ type: "error", message: "Erro ao alternar memória eterna." });
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

      addToast({ type: "success", message: "Memória atualizada." });
      setEditingId(null);
    } catch (err) {
      addToast({ type: "error", message: "Erro ao editar memória." });
    } finally {
      setIsSavingEdit(false);
    }
  };

  // --- Media Modal Handlers ---
  const handleOpenMediaModal = (item) => {
    setSelectedMedia(item);
    setEditingMediaDescription(item.media?.description || item.text || "");
    setShowMediaModal(true);
  };

  const handleSaveMediaDescription = async () => {
    if (!selectedMedia || !editingMediaDescription.trim()) return;

    setIsSavingMediaDescription(true);
    try {
      // Edita o texto da memória (que é usado para busca vetorial)
      await editMemory(chatToken, selectedMedia.messageid, editingMediaDescription);

      // Atualiza local
      const update = (list) => list.map(m =>
        m.messageid === selectedMedia.messageid
          ? { ...m, text: editingMediaDescription }
          : m
      );
      setLocalVectorMemory(prev => update(prev));

      addToast({ type: "success", message: "Descrição atualizada." });
      setShowMediaModal(false);
      setSelectedMedia(null);
    } catch (err) {
      addToast({ type: "error", message: "Erro ao salvar descrição." });
    } finally {
      setIsSavingMediaDescription(false);
    }
  };

  // --- Export Handlers ---
  const handleOpenExport = async () => {
    setShowExportModal(true);
    setIsLoadingStats(true);
    try {
      const stats = await getMemoryStats(chatToken);
      setMemoryStats(stats);
    } catch (err) {
      addToast({ type: "error", message: "Erro ao carregar estatísticas." });
    } finally {
      setIsLoadingStats(false);
    }
  };

  const handleExport = async () => {
    const selectedCollections = Object.entries(exportCollections)
      .filter(([, selected]) => selected)
      .map(([name]) => name);

    if (selectedCollections.length === 0) {
      addToast({ type: "error", message: "Selecione pelo menos uma coleção." });
      return;
    }

    setIsExporting(true);
    try {
      const data = await exportMemories(chatToken, selectedCollections);

      // Cria e faz download do arquivo
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `memories_${chatToken.substring(0, 8)}_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      addToast({ type: "success", message: "Memórias exportadas com sucesso!" });
      setShowExportModal(false);
    } catch (err) {
      addToast({ type: "error", message: "Erro ao exportar memórias." });
    } finally {
      setIsExporting(false);
    }
  };

  // --- Import Handlers ---
  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);

        if (!["1.0", "1.1"].includes(data.version)) {
          addToast({ type: "error", message: `Versão do arquivo não suportada: ${data.version}` });
          return;
        }

        setImportFile(file);
        setImportData(data);

        // Pré-seleciona coleções disponíveis
        const available = {};
        if (data.collections) {
          Object.keys(data.collections).forEach(key => {
            available[key] = data.collections[key].length > 0;
          });
        }
        setImportCollections(available);
        setShowImportModal(true);
      } catch (err) {
        addToast({ type: "error", message: "Arquivo JSON inválido." });
      }
    };
    reader.readAsText(file);

    // Limpa input para permitir selecionar o mesmo arquivo novamente
    e.target.value = "";
  };

  const handleImport = async () => {
    const selectedCollections = Object.entries(importCollections)
      .filter(([, selected]) => selected)
      .map(([name]) => name);

    if (selectedCollections.length === 0) {
      addToast({ type: "error", message: "Selecione pelo menos uma coleção." });
      return;
    }

    setIsImporting(true);
    setImportProgress({ current: 0, total: 0 });

    try {
      const stats = await importMemories(chatToken, importData, selectedCollections, (current, total) => {
        setImportProgress({ current, total });
      });

      addToast({
        type: "success",
        message: `Importação concluída! ${stats?.total || 0} itens importados.`
      });

      setShowImportModal(false);
      setImportFile(null);
      setImportData(null);
    } catch (err) {
      addToast({ type: "error", message: err.message || "Erro ao importar memórias." });
    } finally {
      setIsImporting(false);
    }
  };

  const handleRepairMemories = async () => {
    setIsRepairing(true);
    try {
      // Primeiro verifica se há embeddings zerados
      const checkResponse = await apiClient.get(`/chat/${chatToken}/check-embeddings`);
      const { total, byCollection } = checkResponse.data;

      if (total === 0) {
        addToast({ type: "info", message: "✓ Todas as memórias já estão OK!" });
        return;
      }

      // Mostra quantas precisam de reparo
      addToast({ type: "info", message: `Reparando ${total} memória(s)...` });

      // Executa o reparo
      const response = await apiClient.post(`/chat/${chatToken}/repair-embeddings`);
      const result = response.data;

      if (result.repaired > 0) {
        addToast({ type: "success", message: `${result.repaired} memória(s) reparada(s)!` });
      } else if (result.failed > 0) {
        addToast({ type: "warning", message: `⚠️ Nenhuma reparada. ${result.failed} falha(s).` });
      }
    } catch (error) {
      console.error("[Repair] Error:", error);
      addToast({ type: "error", message: "Erro: " + (error.response?.data?.error || error.message) });
    } finally {
      setIsRepairing(false);
    }
  };

  // All memories for the active tab (RAG context + eternal)
  const memoriesForTab = localVectorMemory.filter(
    (item) => item.category === activeTab
  );

  // Eternal memories as fallback when no RAG context memories exist
  const eternalMemoriesForTab = memoriesForTab.filter(
    (item) => item.eternal === "true"
  );

  // Priority: search results > all tab memories > eternal-only fallback
  const listToRender = searchResults !== null
    ? searchResults
    : memoriesForTab.length > 0
      ? memoriesForTab
      : eternalMemoriesForTab;

  return (
    <div ref={panelRef} className={`${styles.memoryPanelContainer} ${collapsed ? styles.collapsed : ""}`}>

      {/* Botão Toggle Lateral (Fora do wrapper para ficar visível quando colapsado) */}
      <button
        className={styles.collapseButton}
        onClick={onToggleCollapse}
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
              Anotações do DM
            </h3>

            <div className={styles.headerActions}>
              {/* Botão Import */}
              <button
                className={styles.actionBtnHeader}
                onClick={() => fileInputRef.current?.click()}
                title="Importar memórias"
              >
                <Upload size={14} />
              </button>

              {/* Botão Export */}
              <button
                className={styles.actionBtnHeader}
                onClick={handleOpenExport}
                title="Exportar memórias"
              >
                <Download size={14} />
              </button>

              {/* Botão Repair */}
              <button
                className={`${styles.actionBtnHeader} ${isRepairing ? styles.spinning : ''}`}
                onClick={handleRepairMemories}
                title="Reparar embeddings zerados"
                disabled={isRepairing}
              >
                {isRepairing ? <Loader size={14} /> : <Wrench size={14} />}
              </button>

              {/* Botão de Adicionar (Invisível em Histórico) */}
              <button
                className={`${styles.addBtnHeader} ${activeTab === 'historico' ? styles.hidden : ''}`}
                onClick={() => activeTab !== 'historico' && setShowAddModal(true)}
                title={activeTab !== 'historico' ? `Adicionar em ${activeTab}` : ''}
                disabled={activeTab === 'historico'}
              >
                <Plus size={16} />
              </button>
            </div>

            {/* Input oculto para upload de arquivo */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              accept=".json"
              style={{ display: "none" }}
            />
          </div>

          <div className={styles.tabs} ref={tabsContainerRef}>
            <div
              className={styles.tabIndicator}
              style={{ left: indicatorStyle.left, width: indicatorStyle.width }}
            />
            {collections.map((c) => (
              <button
                key={c.id}
                ref={(el) => (tabRefs.current[c.id] = el)}
                className={`${styles.tab} ${activeTab === c.id ? styles.active : ""}`}
                onClick={() => {
                  setActiveTab(c.id);
                  setSearchQuery("");
                  setSearchResults(null);
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
          {isSearching && <Loader size={14} className={styles.searchSpinner} />}
        </div>

        <div className={styles.content}>
          {isSearching ? (
            <div className={styles.emptyMessage}>
              Buscando...
            </div>
          ) : listToRender.length === 0 ? (
            <div className={styles.emptyMessage}>
              {searchQuery
                ? "Nenhum resultado encontrado."
                : "Pesquise uma memória"}
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
                    const tooltipText = [
                      item._score != null ? `Relevância: ${(item._score * 100).toFixed(0)}%` : null,
                      item.createdAt ? `Criado: ${new Date(item.createdAt).toLocaleDateString('pt-BR')}` : null,
                      item.messageid ? `ID: ${String(item.messageid).slice(0, 8)}...` : null
                    ].filter(Boolean).join(' | ');

                    const isEternal = item.eternal === "true";
                    const canToggleEternal = category === "fatos" || category === "conceitos";

                    return (
                      <div
                        key={item.messageid || index}
                        className={`${styles.memoryItem} ${isEternal ? styles.eternalItem : ""}`}
                        title={tooltipText}
                      >
                        {isEditing ? (
                          <div className={styles.editContainer}>
                            <textarea
                              className={styles.editInput}
                              value={editingText}
                              onChange={(e) => setEditingText(e.target.value)}
                              onKeyDown={(e) => {
                                // Permite Enter para quebra de linha
                                if (e.key === "Enter") {
                                  e.stopPropagation();
                                }
                              }}
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
                            {/* Thumbnail de mídia se houver */}
                            {item.hasMedia && item.media && (
                              <div
                                className={styles.mediaThumbnail}
                                onClick={() => handleOpenMediaModal(item)}
                                title="Clique para ver/editar descrição"
                              >
                                {item.media.mimeType?.startsWith("image/") ? (
                                  <img
                                    src={`data:${item.media.mimeType};base64,${item.media.data}`}
                                    alt={item.media.name || "Imagem"}
                                    className={styles.thumbnailImage}
                                  />
                                ) : (
                                  <div className={styles.pdfThumbnail}>
                                    <FileText size={24} />
                                    <span>PDF</span>
                                  </div>
                                )}
                                <div className={styles.thumbnailOverlay}>
                                  <Edit2 size={14} />
                                </div>
                              </div>
                            )}
                            <p className={styles.memoryText}>{item.text}</p>
                            <div className={styles.memoryMeta}>
                              {item._score != null && (
                                <span className={styles.scoreTag}>
                                  {(item._score * 100).toFixed(0)}%
                                </span>
                              )}

                              {item.messageid && (
                                <div className={styles.itemActions}>
                                  {canToggleEternal && (
                                    <button
                                      onClick={() => handleToggleEternal(item)}
                                      className={`${styles.actionBtn} ${isEternal ? styles.eternalActive : ""}`}
                                      title={isEternal ? "Remover memória permanente" : "Fixar como memória permanente"}
                                    >
                                      <Pin size={12} />
                                    </button>
                                  )}
                                  <button
                                    onClick={() => item.hasMedia ? handleOpenMediaModal(item) : startEditing(item)}
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

                            {/* Debug info para calibração do RAG */}
                            {item.debug && (
                              <div className={styles.debugInfo}>
                                <span className={styles.debugPill}>
                                  <span className={styles.debugLabel}>Orig</span>
                                  <span className={styles.debugValue}>{item.debug.originalDistance?.toFixed(3)}</span>
                                </span>
                                <span className={styles.debugPill}>
                                  <span className={styles.debugLabel}>Final</span>
                                  <span className={styles.debugValue}>{item.debug.finalDistance?.toFixed(3)}</span>
                                </span>
                                {item.debug.adaptiveBoost > 0 && (
                                  <span className={`${styles.debugPill} ${styles.debugBoost}`}>
                                    <span className={styles.debugLabel}>Boost</span>
                                    <span className={styles.debugValue}>+{(item.debug.adaptiveBoost * 100).toFixed(0)}%</span>
                                  </span>
                                )}
                                {item.debug.hasPenalty && (
                                  <span className={`${styles.debugPill} ${styles.debugPenalty}`}>Penalty</span>
                                )}
                              </div>
                            )}
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
              onKeyDown={(e) => {
                // Permite Enter para quebra de linha sem propagação
                if (e.key === "Enter") {
                  e.stopPropagation();
                }
              }}
              autoFocus
              rows={6}
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

      {/* Modal de Exportação */}
      {showExportModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h4>
                <Download size={18} />
                Exportar Memórias
              </h4>
              <button onClick={() => setShowExportModal(false)} className={styles.modalCloseBtn}>
                <X size={16} />
              </button>
            </div>

            <div className={styles.modalContent}>
              <p className={styles.modalDescription}>
                Selecione as coleções que deseja exportar:
              </p>

              {isLoadingStats ? (
                <div className={styles.loadingSpinner}>Carregando...</div>
              ) : (
                <div className={styles.checkboxList}>
                  {collections.map((c) => (
                    <label key={c.id} className={styles.checkboxItem}>
                      <input
                        type="checkbox"
                        checked={exportCollections[c.id] || false}
                        onChange={(e) => setExportCollections({
                          ...exportCollections,
                          [c.id]: e.target.checked
                        })}
                      />
                      <span className={styles.checkboxIcon}>
                        {c.icon}
                      </span>
                      <span className={styles.checkboxLabel}>
                        {c.label}
                        <span className={styles.checkboxCount}>
                          ({memoryStats[c.id] || 0} itens)
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className={styles.modalFooter}>
              <button
                className={styles.modalCancelBtn}
                onClick={() => setShowExportModal(false)}
                disabled={isExporting}
              >
                Cancelar
              </button>
              <button
                className={styles.modalSaveBtn}
                onClick={handleExport}
                disabled={isExporting || isLoadingStats}
              >
                <Download size={14} />
                {isExporting ? "Exportando..." : "Exportar JSON"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Importação */}
      {showImportModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h4>
                <Upload size={18} />
                Importar Memórias
              </h4>
              <button
                onClick={() => {
                  setShowImportModal(false);
                  setImportFile(null);
                  setImportData(null);
                }}
                className={styles.modalCloseBtn}
                disabled={isImporting}
              >
                <X size={16} />
              </button>
            </div>

            <div className={styles.modalContent}>
              <div className={styles.importFileInfo}>
                <FileJson size={24} />
                <div>
                  <span className={styles.fileName}>{importFile?.name}</span>
                  {importData?.source?.chatTitle && (
                    <span className={styles.fileSource}>
                      Origem: {importData.source.chatTitle}
                    </span>
                  )}
                </div>
              </div>

              <p className={styles.modalDescription}>
                Selecione o que deseja importar:
              </p>

              <div className={styles.checkboxList}>
                {collections.map((c) => {
                  const count = importData?.statistics?.[c.id] || 0;
                  const hasData = count > 0;
                  return (
                    <label
                      key={c.id}
                      className={`${styles.checkboxItem} ${!hasData ? styles.disabled : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={importCollections[c.id] || false}
                        onChange={(e) => setImportCollections({
                          ...importCollections,
                          [c.id]: e.target.checked
                        })}
                        disabled={!hasData || isImporting}
                      />
                      <span className={styles.checkboxIcon}>
                        {c.icon}
                      </span>
                      <span className={styles.checkboxLabel}>
                        {c.label}
                        <span className={styles.checkboxCount}>
                          ({count} itens)
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>

              {isImporting && (
                <div className={styles.progressContainer}>
                  <div className={styles.progressBar}>
                    <div
                      className={styles.progressFill}
                      style={{
                        width: importProgress.total > 0
                          ? `${(importProgress.current / importProgress.total) * 100}%`
                          : "0%"
                      }}
                    />
                  </div>
                  <span className={styles.progressText}>
                    {importProgress.current} / {importProgress.total}
                  </span>
                </div>
              )}
            </div>

            <div className={styles.modalFooter}>
              <button
                className={styles.modalCancelBtn}
                onClick={() => {
                  setShowImportModal(false);
                  setImportFile(null);
                  setImportData(null);
                }}
                disabled={isImporting}
              >
                Cancelar
              </button>
              <button
                className={styles.modalSaveBtn}
                onClick={handleImport}
                disabled={isImporting || !Object.values(importCollections).some(v => v)}
              >
                <Upload size={14} />
                {isImporting ? "Importando..." : "Importar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Preview de Mídia */}
      {showMediaModal && selectedMedia && (
        <div className={styles.modalOverlay}>
          <div className={`${styles.modal} ${styles.mediaModal}`}>
            <div className={styles.modalHeader}>
              <h4>
                <Image size={18} />
                {selectedMedia.media?.name || "Mídia Recuperada"}
              </h4>
              <button
                onClick={() => {
                  setShowMediaModal(false);
                  setSelectedMedia(null);
                }}
                className={styles.modalCloseBtn}
                disabled={isSavingMediaDescription}
              >
                <X size={16} />
              </button>
            </div>

            <div className={styles.modalContent}>
              {/* Preview da mídia */}
              <div className={styles.mediaPreviewContainer}>
                {selectedMedia.media?.mimeType?.startsWith("image/") ? (
                  <img
                    src={`data:${selectedMedia.media.mimeType};base64,${selectedMedia.media.data}`}
                    alt={selectedMedia.media.name || "Imagem"}
                    className={styles.mediaPreviewImage}
                  />
                ) : (
                  <div className={styles.pdfPreview}>
                    <FileText size={48} />
                    <span>{selectedMedia.media?.name || "Documento PDF"}</span>
                  </div>
                )}
              </div>

              {/* Campo de edição da descrição */}
              <div className={styles.mediaDescriptionSection}>
                <label>Descrição para Busca Vetorial:</label>
                <textarea
                  className={styles.modalTextarea}
                  value={editingMediaDescription}
                  onChange={(e) => setEditingMediaDescription(e.target.value)}
                  onKeyDown={(e) => {
                    // Permite Enter para quebra de linha
                    if (e.key === "Enter") {
                      e.stopPropagation();
                    }
                  }}
                  placeholder="Descreva o conteúdo da imagem para melhorar a busca..."
                  rows={4}
                />
                <p className={styles.hint}>
                  Esta descrição é usada para encontrar esta mídia através da busca vetorial.
                </p>
              </div>
            </div>

            <div className={styles.modalFooter}>
              <button
                className={styles.modalCancelBtn}
                onClick={() => {
                  setShowMediaModal(false);
                  setSelectedMedia(null);
                }}
                disabled={isSavingMediaDescription}
              >
                Cancelar
              </button>
              <button
                className={styles.modalSaveBtn}
                onClick={handleSaveMediaDescription}
                disabled={isSavingMediaDescription || !editingMediaDescription.trim()}
              >
                <Save size={14} />
                {isSavingMediaDescription ? "Salvando..." : "Salvar Descrição"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MemoryPanel;
