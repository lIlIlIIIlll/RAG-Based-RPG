// src/components/ConfigModal/ConfigModal.jsx
import React, { useState, useEffect } from "react";
import { X, Save } from "lucide-react";
import { apiClient, updateChatConfig } from "../services/api"; // Importando helper ou apiClient
import { useToast } from "../context/ToastContext";
import styles from "./ConfigModal.module.css";

const ConfigModal = ({ chatToken, onClose }) => {
  const [config, setConfig] = useState({
    modelName: "gemini-2.5-pro",
    temperature: 0.7,
    systemInstruction: "",
    apiKey: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();

  // Carrega configurações atuais
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const response = await apiClient.get(`/chat/${chatToken}`);
        const currentConfig = response.data.config || {};

        setConfig({
          modelName: currentConfig.modelName || "gemini-2.5-pro",
          temperature: currentConfig.temperature ?? 0.7,
          systemInstruction: currentConfig.systemInstruction || "",
          apiKey: currentConfig.apiKey || "",
        });
      } catch (error) {
        addToast({ type: "error", message: "Erro ao carregar configurações." });
        onClose();
      } finally {
        setLoading(false);
      }
    };
    if (chatToken) loadConfig();
  }, [chatToken, addToast, onClose]);

  // Fecha ao pressionar ESC
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation(); // Impede que outros listeners peguem o evento
        onClose();
      }
    };
    // Use capture: true para garantir que pegamos o evento antes de qualquer outra coisa
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [onClose]);

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateChatConfig(chatToken, config);
      addToast({ type: "success", message: "Configurações salvas com sucesso." });
      onClose();
    } catch (error) {
      addToast({ type: "error", message: "Erro ao salvar configurações." });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  return (
    <div className={styles.overlay} onClick={handleBackdropClick}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2>Configurações do Chat</h2>
          <button onClick={onClose} className={styles.closeBtn}>
            <X size={20} />
          </button>
        </div>

        <div className={styles.body}>
          <div className={styles.field}>
            <label>Modelo (Gemini ID)</label>
            <input
              type="text"
              value={config.modelName}
              onChange={(e) => setConfig({ ...config, modelName: e.target.value })}
              placeholder="ex: gemini-2.5-flash"
            />
            <span className={styles.hint}>
              Certifique-se de que o modelo é compatível com sua API Key.
            </span>
          </div>

          <div className={styles.field}>
            <label>Gemini API Key</label>
            <input
              type="password"
              value={config.apiKey || ""}
              onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
              placeholder="Cole sua API Key aqui..."
            />
            <span className={styles.hint}>
              Sua chave será salva apenas para este chat.
            </span>
          </div>

          <div className={styles.field}>
            <label>Temperatura ({config.temperature})</label>
            <div className={styles.sliderContainer}>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={config.temperature}
                onChange={(e) => setConfig({ ...config, temperature: parseFloat(e.target.value) })}
              />
              <div className={styles.sliderLabels}>
                <span>Preciso</span>
                <span>Criativo</span>
              </div>
            </div>
          </div>

          <div className={styles.field}>
            <label>Instruções do Sistema (System Prompt)</label>
            <textarea
              value={config.systemInstruction}
              onChange={(e) => setConfig({ ...config, systemInstruction: e.target.value })}
              placeholder="Defina a persona e regras da IA..."
              rows={6}
            />
            <span className={styles.hint}>
              Use a tag <code>{`{vector_memory}`}</code> onde deseja que o contexto recuperado seja inserido.
            </span>
          </div>
        </div>

        <div className={styles.footer}>
          <button onClick={onClose} className={styles.cancelBtn} disabled={saving}>
            Cancelar
          </button>
          <button onClick={handleSave} className={styles.saveBtn} disabled={saving}>
            <Save size={16} />
            {saving ? "Salvando..." : "Salvar Alterações"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfigModal;