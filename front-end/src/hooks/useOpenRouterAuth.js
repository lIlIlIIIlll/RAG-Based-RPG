// src/hooks/useOpenRouterAuth.js
import { useEffect, useCallback, useState } from "react";
import { useToast } from "../context/ToastContext";
import { updateChatConfig } from "../services/api";

/**
 * Hook para gerenciar autenticação OAuth PKCE com OpenRouter.
 * Deve ser usado em um componente que está sempre montado (ex: ChatInterface).
 */
export function useOpenRouterAuth() {
    const [isProcessingCallback, setIsProcessingCallback] = useState(false);
    const { addToast } = useToast();

    const processOAuthCallback = useCallback(async () => {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        const storedVerifier = localStorage.getItem('openrouter_code_verifier');
        const pendingChatToken = localStorage.getItem('openrouter_pending_chat');

        console.log('[OAuth Callback] Checking...', { code: !!code, storedVerifier: !!storedVerifier, pendingChatToken });

        if (!code || !storedVerifier) return null;

        setIsProcessingCallback(true);

        try {
            console.log('[OAuth] Exchanging code for API key...');
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
                const errorText = await response.text();
                console.error('[OAuth] Error response:', errorText);
                throw new Error('Falha ao obter API Key do OpenRouter');
            }

            const data = await response.json();
            console.log('[OAuth] Response:', { hasKey: !!data.key });

            if (data.key) {
                // Se temos um chat pendente, salva a key diretamente na config do chat
                if (pendingChatToken) {
                    console.log('[OAuth] Saving key to chat:', pendingChatToken);
                    await updateChatConfig(pendingChatToken, { openrouterApiKey: data.key });
                }

                addToast({ type: "success", message: "Conectado ao OpenRouter com sucesso!" });
                return data.key;
            }
        } catch (error) {
            console.error('[OAuth] Error:', error);
            addToast({ type: "error", message: "Erro ao conectar com OpenRouter: " + error.message });
        } finally {
            // Limpa localStorage e URL
            localStorage.removeItem('openrouter_code_verifier');
            localStorage.removeItem('openrouter_pending_chat');
            window.history.replaceState({}, document.title, window.location.pathname);
            setIsProcessingCallback(false);
        }

        return null;
    }, [addToast]);

    // Processa callback automaticamente quando o componente monta
    useEffect(() => {
        processOAuthCallback();
    }, [processOAuthCallback]);

    return { isProcessingCallback };
}
