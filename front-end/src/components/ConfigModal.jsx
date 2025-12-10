// src/components/ConfigModal/ConfigModal.jsx
import React, { useState, useEffect } from "react";
import { X, Save } from "lucide-react";
import { apiClient, updateChatConfig } from "../services/api"; // Importando helper ou apiClient
import { useToast } from "../context/ToastContext";
import styles from "./ConfigModal.module.css";

// Modelos disponíveis por provedor
const MODELS = {
  gemini: [
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
    { id: "gemini-2.0-flash-thinking-exp", name: "Gemini 2.0 Flash Thinking" },
  ],
  anthropic: [
    { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
    { id: "claude-opus-4-20250514", name: "Claude Opus 4" },
    { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet" },
    { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku" },
  ]
};

const ConfigModal = ({ chatToken, onClose }) => {
  const [config, setConfig] = useState({
    llmProvider: "gemini",
    modelName: "gemini-2.5-pro",
    temperature: 0.7,
    systemInstruction: "",
    apiKey: "",
    anthropicApiKey: "",
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
          llmProvider: currentConfig.llmProvider || "gemini",
          modelName: currentConfig.modelName || "gemini-2.5-pro",
          temperature: currentConfig.temperature ?? 0.7,
          systemInstruction: currentConfig.systemInstruction || "",
          apiKey: currentConfig.apiKey || "",
          anthropicApiKey: currentConfig.anthropicApiKey || "",
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

  const handleProviderChange = (newProvider) => {
    // Ao mudar o provedor, atualiza o modelo padrão
    const defaultModel = MODELS[newProvider]?.[0]?.id || "gemini-2.5-pro";
    setConfig({ ...config, llmProvider: newProvider, modelName: defaultModel });
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

  const availableModels = MODELS[config.llmProvider] || MODELS.gemini;

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
          {/* Seleção do Provedor de LLM */}
          <div className={styles.field}>
            <label>Provedor de LLM (Narração)</label>
            <div className={styles.providerToggle}>
              <button
                type="button"
                className={`${styles.providerBtn} ${config.llmProvider === "gemini" ? styles.active : ""}`}
                onClick={() => handleProviderChange("gemini")}
              >
                🔮 Gemini
              </button>
              <button
                type="button"
                className={`${styles.providerBtn} ${config.llmProvider === "anthropic" ? styles.active : ""}`}
                onClick={() => handleProviderChange("anthropic")}
              >
                🤖 Claude
              </button>
            </div>
            <span className={styles.hint}>
              O Gemini será usado para embeddings e busca vetorial, independente do provedor selecionado.
            </span>
          </div>

          {/* Seleção do Modelo */}
          <div className={styles.field}>
            <label>Modelo ({config.llmProvider === "gemini" ? "Gemini" : "Claude"})</label>
            {config.llmProvider === "gemini" ? (
              <select
                value={config.modelName}
                onChange={(e) => setConfig({ ...config, modelName: e.target.value })}
                className={styles.select}
              >
                {availableModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={config.modelName}
                onChange={(e) => setConfig({ ...config, modelName: e.target.value })}
                placeholder="ex: claude-sonnet-4-20250514"
              />
            )}
            <span className={styles.hint}>
              {config.llmProvider === "gemini"
                ? "Certifique-se de que o modelo é compatível com sua API Key."
                : "Digite o identificador do modelo Claude (ex: claude-sonnet-4-20250514, claude-3-5-sonnet-20241022)."}
            </span>
          </div>

          {/* API Key do Gemini (sempre necessária para embeddings) */}
          <div className={styles.field}>
            <label>Gemini API Key {config.llmProvider === "anthropic" ? "(apenas embeddings)" : ""}</label>
            <input
              type="password"
              value={config.apiKey || ""}
              onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
              placeholder="Cole sua API Key do Gemini aqui..."
            />
            <span className={styles.hint}>
              {config.llmProvider === "anthropic"
                ? "Necessária para busca vetorial e embeddings."
                : "Sua chave será salva apenas para este chat."}
            </span>
          </div>

          {/* API Key do Anthropic (apenas se o provedor for anthropic) */}
          {config.llmProvider === "anthropic" && (
            <div className={styles.field}>
              <label>Claude API Key (Anthropic)</label>
              <input
                type="password"
                value={config.anthropicApiKey || ""}
                onChange={(e) => setConfig({ ...config, anthropicApiKey: e.target.value })}
                placeholder="Cole sua API Key do Anthropic aqui..."
              />
              <span className={styles.hint}>
                Sua chave do Anthropic será usada apenas para geração de texto.
              </span>
            </div>
          )}

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
