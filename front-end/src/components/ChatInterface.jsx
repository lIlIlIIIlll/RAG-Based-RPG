import React, { useState } from "react";
import ChatList from "./ChatList.jsx";
import ChatView from "./ChatView.jsx";
import { createChat } from "../services/api.js";
import { useToast } from "../context/ToastContext";
import { MessageSquarePlus, Terminal } from "lucide-react";
import styles from "./ChatInterface.module.css";

function ChatInterface() {
    const [activeChatToken, setActiveChatToken] = useState(null);
    const [isCreatingChat, setIsCreatingChat] = useState(false);
    const { addToast } = useToast();

    const handleNewChat = async () => {
        setIsCreatingChat(true);
        try {
            const token = await createChat();
            setActiveChatToken(token);
            // O ChatList irá recarregar automaticamente devido à mudança de token ou prop
        } catch (err) {
            addToast({
                type: "error",
                message: "Não foi possível criar uma nova campanha.",
            });
        } finally {
            setIsCreatingChat(false);
        }
    };

    return (
        <div className={styles.appContainer}>
            {/* Sidebar de Navegação */}
            <ChatList
                activeChatToken={activeChatToken}
                onSelectChat={setActiveChatToken}
                onNewChat={handleNewChat}
                isCreating={isCreatingChat}
            />

            {/* Área Principal */}
            <main className={styles.mainContent}>
                {activeChatToken ? (
                    // Usamos key=activeChatToken para forçar a remontagem completa do componente
                    // ao trocar de chat, garantindo limpeza de estados internos.
                    <ChatView key={activeChatToken} chatToken={activeChatToken} />
                ) : (
                    <div className={styles.welcomeScreen}>
                        <div className={styles.welcomeIcon}>
                            <Terminal size={64} strokeWidth={1} />
                        </div>
                        <h1>Dungeon Master 69</h1>
                        <p>
                            Selecione uma campanha existente ou inicie uma nova.
                        </p>
                        <button className={styles.ctaButton} onClick={handleNewChat}>
                            <MessageSquarePlus size={20} />
                            Começar Agora
                        </button>
                    </div>
                )}
            </main>
        </div>
    );
}

export default ChatInterface;
