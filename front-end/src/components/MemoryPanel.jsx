// src/components/MemoryPanel.jsx
import React, { useState, useEffect, useRef } from "react";
import {
  Search, Plus, Edit2, Save, X, Trash2,
  Database, Brain, History, ChevronRight, ChevronLeft,
  Download, Upload, FileJson, CheckCircle, AlertCircle
} from "lucide-react";
import { addMemory, editMemory, deleteMessage, getMemoryStats, exportMemories, importMemories } from "../services/api";
import { useToast } from "../context/ToastContext";
import { useConfirmation } from "../context/ConfirmationContext";
import styles from "./MemoryPanel.module.css";

const MemoryPanel = ({ chatToken, vectorMemory }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState("historico");
  const [localVectorMemory, setLocalVectorMemory] = useState(vectorMemory || []);

  const [searchQuery, setSearchQuery] = useState("");

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

  const fileInputRef = useRef(null);

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

  const listToRender = localVectorMemory.filter(item => {
    const matchesTab = item.category === activeTab;
    const matchesSearch = searchQuery.trim() === "" || item.text.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesTab && matchesSearch;
  });

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

          <div className={styles.tabs}>
            {collections.map((c) => (
              <button
                key={c.id}
                className={`${styles.tab} ${activeTab === c.id ? styles.active : ""}`}
                onClick={() => {
                  setActiveTab(c.id);
                  setSearchQuery("");
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
    </div>
  );
};

export default MemoryPanel;
