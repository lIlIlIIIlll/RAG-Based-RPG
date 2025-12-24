// src/components/ConfigModal/ConfigModal.jsx
import React, { useState, useEffect, useCallback } from "react";
import { X, Save, ExternalLink, Check, AlertCircle, Zap, Search, Key, Settings, Cpu } from "lucide-react";
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

// Modelos populares do Google (direto)
const GOOGLE_MODELS = [
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
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
    // Google Provider fields
    provider: "openrouter",
    googleApiKeys: [],
    googleModelName: "gemini-2.5-flash",
    rateLimits: { rpm: 5, tpm: 250000, rpd: 20 },
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [allModels, setAllModels] = useState([]);
  const [filteredModels, setFilteredModels] = useState([]);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [googleApiKeysText, setGoogleApiKeysText] = useState(""); // For textarea
  const { addToast } = useToast();

  // Carrega todos os modelos do OpenRouter
  useEffect(() => {
    const fetchModels = async () => {
      try {
        const response = await fetch('https://openrouter.ai/api/v1/models');
        if (response.ok) {
          const data = await response.json();
          // Ordena por nome e extrai id/name
          const models = (data.data || [])
            .map(m => ({ id: m.id, name: m.name, context: m.context_length }))
            .sort((a, b) => a.name.localeCompare(b.name));
          setAllModels(models);
          setFilteredModels(models.slice(0, 20)); // Mostra top 20 inicialmente
          console.log(`[Models] Loaded ${models.length} models from OpenRouter`);
        }
      } catch (error) {
        console.warn('[Models] Failed to fetch models:', error);
        // Fallback para modelos populares
        setAllModels(POPULAR_MODELS);
        setFilteredModels(POPULAR_MODELS);
      }
    };
    fetchModels();
  }, []);

  // Filtra modelos baseado no input
  const handleModelSearch = (searchTerm) => {
    setConfig({ ...config, modelName: searchTerm });
    setShowModelDropdown(true);

    if (!searchTerm.trim()) {
      setFilteredModels(allModels.slice(0, 20));
      return;
    }

    const term = searchTerm.toLowerCase();
    const matches = allModels
      .filter(m => m.id.toLowerCase().includes(term) || m.name.toLowerCase().includes(term))
      .slice(0, 30);
    setFilteredModels(matches);
  };

  const selectModel = (modelId) => {
    setConfig({ ...config, modelName: modelId });
    setShowModelDropdown(false);
  };

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

        const googleKeys = currentConfig.googleApiKeys || [];
        setGoogleApiKeysText(googleKeys.join("\n"));

        setConfig({
          modelName: currentConfig.modelName || "google/gemini-2.5-pro-preview",
          temperature: currentConfig.temperature ?? 0.7,
          systemInstruction: currentConfig.systemInstruction || "",
          geminiApiKey: currentConfig.geminiApiKey || "",
          openrouterApiKey: currentConfig.openrouterApiKey || "",
          // Google Provider fields
          provider: currentConfig.provider || "openrouter",
          googleApiKeys: googleKeys,
          googleModelName: currentConfig.googleModelName || "gemini-2.5-flash",
          rateLimits: currentConfig.rateLimits || { rpm: 5, tpm: 250000, rpd: 20 },
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
    localStorage.setItem('openrouter_pending_chat', chatToken); // Salva o chat token para callback

    const callbackUrl = window.location.origin + window.location.pathname;
    console.log('[OAuth] Callback URL:', callbackUrl);
    console.log('[OAuth] Code Challenge:', codeChallenge);

    const authUrl = `https://openrouter.ai/auth?callback_url=${encodeURIComponent(callbackUrl)}&code_challenge=${codeChallenge}&code_challenge_method=S256`;
    console.log('[OAuth] Auth URL:', authUrl);

    window.location.href = authUrl;
  };

  // Atualiza Google API Keys do textarea
  const handleGoogleApiKeysChange = (text) => {
    setGoogleApiKeysText(text);
    const keys = text.split("\n").map(k => k.trim()).filter(k => k.length > 0);
    setConfig({ ...config, googleApiKeys: keys });
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
  const isGoogleConfigured = config.googleApiKeys && config.googleApiKeys.length > 0;
  const isGoogleProvider = config.provider === "google";

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
          {/* Provider Toggle */}
          <div className={styles.providerToggle}>
            <label className={styles.toggleLabel}>
              <Cpu size={16} />
              Provider LLM
            </label>
            <div className={styles.toggleButtons}>
              <button
                type="button"
                className={`${styles.toggleBtn} ${!isGoogleProvider ? styles.toggleActive : ''}`}
                onClick={() => setConfig({ ...config, provider: "openrouter" })}
              >
                <Zap size={14} />
                OpenRouter
              </button>
              <button
                type="button"
                className={`${styles.toggleBtn} ${isGoogleProvider ? styles.toggleActive : ''}`}
                onClick={() => setConfig({ ...config, provider: "google" })}
              >
                <Cpu size={14} />
                Google Direct
              </button>
            </div>
          </div>

          {/* OpenRouter Section */}
          {!isGoogleProvider && (
            <div className={styles.openrouterCard}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitle}>
                  <Zap size={20} className={styles.openrouterIcon} />
                  <span>OpenRouter</span>
                </div>
                <div className={`${styles.connectionBadge} ${isOpenRouterConnected ? styles.badgeConnected : styles.badgeDisconnected}`}>
                  {isOpenRouterConnected ? (
                    <>
                      <Check size={14} />
                      <span>Conectado</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle size={14} />
                      <span>Desconectado</span>
                    </>
                  )}
                </div>
              </div>

              <div className={styles.cardContent}>
                {/* Modelo OpenRouter */}
                <div className={styles.modelSection}>
                  <label>
                    <Search size={14} />
                    Modelo
                  </label>
                  <div className={styles.modelSearchContainer}>
                    <input
                      type="text"
                      value={config.modelName}
                      onChange={(e) => handleModelSearch(e.target.value)}
                      onFocus={() => setShowModelDropdown(true)}
                      onBlur={() => setTimeout(() => setShowModelDropdown(false), 200)}
                      placeholder="Buscar modelo..."
                      autoComplete="off"
                      className={styles.modelInput}
                    />
                    {showModelDropdown && filteredModels.length > 0 && (
                      <div className={styles.modelDropdown}>
                        {filteredModels.map((model) => (
                          <div
                            key={model.id}
                            className={styles.modelOption}
                            onMouseDown={() => selectModel(model.id)}
                          >
                            <span className={styles.modelId}>{model.id}</span>
                            <span className={styles.modelName}>{model.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className={styles.modelCount}>
                    {allModels.length} modelos disponíveis
                  </span>
                </div>

                {/* Botão de Conexão */}
                <button
                  type="button"
                  className={`${styles.openrouterBtn} ${isOpenRouterConnected ? styles.reconnect : ''}`}
                  onClick={handleConnectOpenRouter}
                  disabled={isConnecting}
                >
                  <ExternalLink size={16} />
                  {isConnecting ? "Conectando..." : isOpenRouterConnected ? "Reconectar" : "Conectar ao OpenRouter"}
                </button>
              </div>
            </div>
          )}

          {/* Google Provider Section */}
          {isGoogleProvider && (
            <div className={styles.openrouterCard}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitle}>
                  <Cpu size={20} className={styles.openrouterIcon} />
                  <span>Google Gemini (Direto)</span>
                </div>
                <div className={`${styles.connectionBadge} ${isGoogleConfigured ? styles.badgeConnected : styles.badgeDisconnected}`}>
                  {isGoogleConfigured ? (
                    <>
                      <Check size={14} />
                      <span>{config.googleApiKeys.length} key(s)</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle size={14} />
                      <span>Sem Keys</span>
                    </>
                  )}
                </div>
              </div>

              <div className={styles.cardContent}>
                {/* Modelo Google */}
                <div className={styles.modelSection}>
                  <label>
                    <Cpu size={14} />
                    Modelo Google
                  </label>
                  <input
                    type="text"
                    value={config.googleModelName}
                    onChange={(e) => setConfig({ ...config, googleModelName: e.target.value })}
                    placeholder="gemini-2.5-flash"
                    className={styles.modelInput}
                  />
                </div>

                {/* API Keys Textarea */}
                <div className={styles.modelSection}>
                  <label>
                    <Key size={14} />
                    API Keys (uma por linha)
                  </label>
                  <textarea
                    value={googleApiKeysText}
                    onChange={(e) => handleGoogleApiKeysChange(e.target.value)}
                    onKeyDown={(e) => {
                      // Permite Enter e Shift+Enter para quebra de linha sem propagação
                      if (e.key === "Enter") {
                        e.stopPropagation();
                      }
                    }}
                    placeholder={"AIzaSyABC123...\nAIzaSyDEF456...\nAIzaSyGHI789..."}
                    rows={4}
                    className={styles.apiKeysTextarea}
                  />
                  <span className={styles.hint}>
                    ⚡ Keys rotacionam automaticamente quando atingem o limite diário (20 requests/dia).
                  </span>
                </div>

                {/* Rate Limits Config */}
                <div className={styles.rateLimitsSection}>
                  <label>
                    <Settings size={14} />
                    Limites (por API Key)
                  </label>
                  <div className={styles.rateLimitsGrid}>
                    <div className={styles.rateLimitInput}>
                      <span>RPD</span>
                      <input
                        type="number"
                        value={config.rateLimits.rpd}
                        onChange={(e) => setConfig({
                          ...config,
                          rateLimits: { ...config.rateLimits, rpd: parseInt(e.target.value) || 20 }
                        })}
                        min="1"
                        max="1000"
                      />
                    </div>
                    <div className={styles.rateLimitInput}>
                      <span>RPM</span>
                      <input
                        type="number"
                        value={config.rateLimits.rpm}
                        onChange={(e) => setConfig({
                          ...config,
                          rateLimits: { ...config.rateLimits, rpm: parseInt(e.target.value) || 5 }
                        })}
                        min="1"
                        max="100"
                      />
                    </div>
                  </div>
                  <span className={styles.hint}>
                    Ajuste baseado no modelo escolhido. Gemini 2.5 Flash: 10 RPM, 250 RPD.
                  </span>
                </div>
              </div>
            </div>
          )}

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
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.shiftKey) {
                  e.preventDefault();
                  const start = e.target.selectionStart;
                  const end = e.target.selectionEnd;
                  const newValue = config.systemInstruction.substring(0, start) + "\n" + config.systemInstruction.substring(end);
                  setConfig({ ...config, systemInstruction: newValue });
                  setTimeout(() => {
                    e.target.selectionStart = e.target.selectionEnd = start + 1;
                  }, 0);
                }
              }}
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
