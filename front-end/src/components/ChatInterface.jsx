import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import ChatList from "./ChatList.jsx";
import ChatView from "./ChatView.jsx";
import { createChat } from "../services/api.js";
import { useToast } from "../context/ToastContext";
import { MessageSquarePlus, Terminal } from "lucide-react";
import styles from "./ChatInterface.module.css";

function ChatInterface() {
    const { chatId } = useParams();
    const navigate = useNavigate();
    const [activeChatToken, setActiveChatToken] = useState(chatId || null);
    const [isCreatingChat, setIsCreatingChat] = useState(false);
    const { addToast } = useToast();

    // Sincroniza o activeChatToken com a URL
    useEffect(() => {
        setActiveChatToken(chatId || null);
    }, [chatId]);

    const handleSelectChat = (token) => {
        if (token) {
            navigate(`/c/${token}`);
        } else {
            navigate('/chat');
        }
    };

    const handleNewChat = async () => {
        setIsCreatingChat(true);
        try {
            const token = await createChat();
            navigate(`/c/${token}`);
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
                onSelectChat={handleSelectChat}
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
                        <h1>Dungeon Master</h1>
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
