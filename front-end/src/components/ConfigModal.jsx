// src/components/ConfigModal/ConfigModal.jsx
import React, { useState, useEffect, useCallback } from "react";
import { X, Save, ExternalLink, Check, AlertCircle } from "lucide-react";
import { apiClient, updateChatConfig } from "../services/api";
import { useToast } from "../context/ToastContext";
import styles from "./ConfigModal.module.css";

// Modelos populares do OpenRouter
const POPULAR_MODELS = [
  { id: "google/gemini-2.5-pro-preview", name: "Gemini 2.5 Pro" },
  { id: "google/gemini-2.5-flash-preview", name: "Gemini 2.5 Flash" },
  { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4" },
  { id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet" },
  { id: "openai/gpt-4o", name: "GPT-4o" },
  { id: "meta-llama/llama-4-maverick", name: "Llama 4 Maverick" },
];

// Gera code_verifier e code_challenge para OAuth PKCE
async function generatePKCE() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const codeVerifier = btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return { codeVerifier, codeChallenge };
}

const ConfigModal = ({ chatToken, onClose }) => {
  const [config, setConfig] = useState({
    modelName: "google/gemini-2.5-pro-preview",
    temperature: 0.7,
    systemInstruction: "",
    geminiApiKey: "",
    openrouterApiKey: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const { addToast } = useToast();

  // Verifica se há código OAuth na URL (callback)
  const handleOAuthCallback = useCallback(async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const storedVerifier = localStorage.getItem('openrouter_code_verifier');

    if (code && storedVerifier) {
      setIsConnecting(true);
      try {
        const response = await fetch('https://openrouter.ai/api/v1/auth/keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code,
            code_verifier: storedVerifier,
            code_challenge_method: 'S256',
          }),
        });

        if (!response.ok) {
          throw new Error('Falha ao obter API Key do OpenRouter');
        }

        const data = await response.json();
        if (data.key) {
          setConfig(prev => ({ ...prev, openrouterApiKey: data.key }));
          addToast({ type: "success", message: "Conectado ao OpenRouter com sucesso!" });
        }
      } catch (error) {
        addToast({ type: "error", message: "Erro ao conectar com OpenRouter: " + error.message });
      } finally {
        localStorage.removeItem('openrouter_code_verifier');
        // Limpa a URL
        window.history.replaceState({}, document.title, window.location.pathname);
        setIsConnecting(false);
      }
    }
  }, [addToast]);

  // Carrega configurações atuais
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const response = await apiClient.get(`/chat/${chatToken}`);
        const currentConfig = response.data.config || {};

        setConfig({
          modelName: currentConfig.modelName || "google/gemini-2.5-pro-preview",
          temperature: currentConfig.temperature ?? 0.7,
          systemInstruction: currentConfig.systemInstruction || "",
          geminiApiKey: currentConfig.geminiApiKey || "",
          openrouterApiKey: currentConfig.openrouterApiKey || "",
        });
      } catch (error) {
        addToast({ type: "error", message: "Erro ao carregar configurações." });
        onClose();
      } finally {
        setLoading(false);
      }
    };

    handleOAuthCallback();
    if (chatToken) loadConfig();
  }, [chatToken, addToast, onClose, handleOAuthCallback]);

  // Fecha ao pressionar ESC
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [onClose]);

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleConnectOpenRouter = async () => {
    const { codeVerifier, codeChallenge } = await generatePKCE();
    localStorage.setItem('openrouter_code_verifier', codeVerifier);

    const callbackUrl = window.location.origin + window.location.pathname;
    const authUrl = `https://openrouter.ai/auth?callback_url=${encodeURIComponent(callbackUrl)}&code_challenge=${codeChallenge}&code_challenge_method=S256`;

    window.location.href = authUrl;
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

  const isOpenRouterConnected = !!config.openrouterApiKey;

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
          {/* Status de Conexão OpenRouter */}
          <div className={styles.field}>
            <label>OpenRouter</label>
            <div className={styles.connectionStatus}>
              {isOpenRouterConnected ? (
                <div className={styles.connected}>
                  <Check size={16} />
                  <span>Conectado</span>
                </div>
              ) : (
                <div className={styles.disconnected}>
                  <AlertCircle size={16} />
                  <span>Não conectado</span>
                </div>
              )}
              <button
                type="button"
                className={styles.connectBtn}
                onClick={handleConnectOpenRouter}
                disabled={isConnecting}
              >
                <ExternalLink size={14} />
                {isConnecting ? "Conectando..." : isOpenRouterConnected ? "Reconectar" : "Conectar com OpenRouter"}
              </button>
            </div>
            <span className={styles.hint}>
              Conecte-se ao OpenRouter para acessar centenas de modelos de IA.
            </span>
          </div>

          {/* Seleção do Modelo */}
          <div className={styles.field}>
            <label>Modelo</label>
            <input
              type="text"
              value={config.modelName}
              onChange={(e) => setConfig({ ...config, modelName: e.target.value })}
              placeholder="ex: google/gemini-2.5-pro-preview"
              list="model-suggestions"
            />
            <datalist id="model-suggestions">
              {POPULAR_MODELS.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </datalist>
            <span className={styles.hint}>
              Digite o identificador do modelo ou selecione da lista.
              <a href="https://openrouter.ai/models" target="_blank" rel="noopener noreferrer"> Ver todos os modelos</a>
            </span>
          </div>

          {/* API Key do Gemini (apenas embeddings) */}
          <div className={styles.field}>
            <label>Gemini API Key (Embeddings)</label>
            <input
              type="password"
              value={config.geminiApiKey || ""}
              onChange={(e) => setConfig({ ...config, geminiApiKey: e.target.value })}
              placeholder="Cole sua API Key do Gemini aqui..."
            />
            <span className={styles.hint}>
              Necessária para busca semântica e memória vetorial.
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
