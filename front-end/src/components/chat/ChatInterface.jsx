import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import ChatList from "./ChatList.jsx";
import ChatView from "./ChatView.jsx";
import { createChat } from "../../services/api.js";
import { useToast } from "../../context/ToastContext";
import { useOpenRouterAuth } from "../../hooks/useOpenRouterAuth.js";
import { MessageSquarePlus, Terminal } from "lucide-react";
import styles from "./ChatInterface.module.css";

const CHATLIST_WIDTH = 300;
const MEMORY_PANEL_WIDTH = 320;
const SNAP_THRESHOLD = 0.35;

function ChatInterface() {
    const { chatId } = useParams();
    const navigate = useNavigate();
    const [activeChatToken, setActiveChatToken] = useState(chatId || null);
    const [isCreatingChat, setIsCreatingChat] = useState(false);
    const { addToast } = useToast();

    // Lifted sidebar states
    const [chatListCollapsed, setChatListCollapsed] = useState(false);
    const [memoryPanelCollapsed, setMemoryPanelCollapsed] = useState(false);

    // Refs for direct DOM manipulation during drag
    const chatListRef = useRef(null);
    const memoryPanelRef = useRef(null);
    const backdropRef = useRef(null);
    const dragRef = useRef(null);
    const [dragTarget, setDragTarget] = useState(null);

    // Processa OAuth callback do OpenRouter se houver
    useOpenRouterAuth();

    // Sincroniza o activeChatToken com a URL
    useEffect(() => {
        setActiveChatToken(chatId || null);
    }, [chatId]);

    const isMobile = () => window.innerWidth <= 768;

    const handleSelectChat = (token) => {
        if (token) {
            navigate(`/c/${token}`);
        } else {
            navigate('/chat');
        }
        if (isMobile()) setChatListCollapsed(true);
    };

    const handleNewChat = async () => {
        setIsCreatingChat(true);
        try {
            const token = await createChat();
            navigate(`/c/${token}`);
            if (isMobile()) setChatListCollapsed(true);
        } catch (err) {
            addToast({
                type: "error",
                message: "Não foi possível criar uma nova campanha.",
            });
        } finally {
            setIsCreatingChat(false);
        }
    };

    const handleBackdropClick = useCallback(() => {
        if (!chatListCollapsed) setChatListCollapsed(true);
        if (!memoryPanelCollapsed) setMemoryPanelCollapsed(true);
    }, [chatListCollapsed, memoryPanelCollapsed]);

    // ── Drag gesture handlers ───────────────────────────────────

    const handleTouchStart = useCallback((e) => {
        if (!isMobile()) return;
        const touch = e.touches[0];
        dragRef.current = {
            startX: touch.clientX,
            startY: touch.clientY,
            isDragging: false,
            target: null,
            direction: null,
        };
    }, []);

    const handleTouchMove = useCallback((e) => {
        if (!dragRef.current) return;

        const touch = e.touches[0];
        const deltaX = touch.clientX - dragRef.current.startX;
        const deltaY = touch.clientY - dragRef.current.startY;

        // First significant move: decide if this is a horizontal drag
        if (!dragRef.current.isDragging) {
            if (Math.abs(deltaX) < 10 && Math.abs(deltaY) < 10) return;

            // Vertical scroll — abort gesture
            if (Math.abs(deltaY) > Math.abs(deltaX)) {
                dragRef.current = null;
                return;
            }

            // Determine which sidebar and direction
            if (deltaX > 0) {
                if (!memoryPanelCollapsed) {
                    dragRef.current.target = 'memory';
                    dragRef.current.direction = 'close';
                } else if (chatListCollapsed) {
                    dragRef.current.target = 'chatlist';
                    dragRef.current.direction = 'open';
                } else {
                    dragRef.current = null;
                    return;
                }
            } else {
                if (!chatListCollapsed) {
                    dragRef.current.target = 'chatlist';
                    dragRef.current.direction = 'close';
                } else if (memoryPanelCollapsed) {
                    dragRef.current.target = 'memory';
                    dragRef.current.direction = 'open';
                } else {
                    dragRef.current = null;
                    return;
                }
            }

            dragRef.current.isDragging = true;

            // Show full content during drag-to-open
            if (dragRef.current.direction === 'open') {
                setDragTarget(dragRef.current.target);
            }

            // Disable CSS transitions during drag for instant feedback
            const el = dragRef.current.target === 'chatlist'
                ? chatListRef.current
                : memoryPanelRef.current;
            if (el) el.style.transition = 'none';

            // Prepare backdrop for opacity tracking
            if (backdropRef.current) {
                backdropRef.current.style.transition = 'none';
                backdropRef.current.style.pointerEvents = 'auto';
            }
        }

        if (!dragRef.current?.isDragging) return;

        const { target, direction } = dragRef.current;
        const width = target === 'chatlist' ? CHATLIST_WIDTH : MEMORY_PANEL_WIDTH;

        if (target === 'chatlist') {
            // ChatList: translateX from -width (closed) to 0 (open)
            let offset;
            if (direction === 'open') {
                offset = Math.min(0, Math.max(-width, -width + deltaX));
            } else {
                offset = Math.min(0, Math.max(-width, deltaX));
            }
            if (chatListRef.current) {
                chatListRef.current.style.transform = `translateX(${offset}px)`;
            }
            const progress = 1 - Math.abs(offset) / width;
            if (backdropRef.current) {
                backdropRef.current.style.opacity = String(progress);
            }
        } else {
            // MemoryPanel: translateX from +width (closed) to 0 (open)
            let offset;
            if (direction === 'open') {
                offset = Math.max(0, Math.min(width, width + deltaX));
            } else {
                offset = Math.max(0, Math.min(width, deltaX));
            }
            if (memoryPanelRef.current) {
                memoryPanelRef.current.style.transform = `translateX(${offset}px)`;
            }
            const progress = 1 - offset / width;
            if (backdropRef.current) {
                backdropRef.current.style.opacity = String(progress);
            }
        }
    }, [chatListCollapsed, memoryPanelCollapsed]);

    const handleTouchEnd = useCallback((e) => {
        if (!dragRef.current?.isDragging) {
            dragRef.current = null;
            return;
        }

        const touch = e.changedTouches[0];
        const deltaX = touch.clientX - dragRef.current.startX;
        const { target, direction } = dragRef.current;
        const width = target === 'chatlist' ? CHATLIST_WIDTH : MEMORY_PANEL_WIDTH;
        const threshold = width * SNAP_THRESHOLD;

        // Re-enable CSS transitions — the snap animation will use them
        const el = target === 'chatlist' ? chatListRef.current : memoryPanelRef.current;
        if (el) {
            el.style.transition = '';
            el.style.transform = '';
        }
        if (backdropRef.current) {
            backdropRef.current.style.transition = '';
            backdropRef.current.style.opacity = '';
            backdropRef.current.style.pointerEvents = '';
        }

        // Determine final state based on drag distance
        if (target === 'chatlist') {
            if (direction === 'open' && deltaX > threshold) {
                setChatListCollapsed(false);
            } else if (direction === 'close' && Math.abs(deltaX) > threshold) {
                setChatListCollapsed(true);
            }
        } else {
            if (direction === 'open' && Math.abs(deltaX) > threshold) {
                setMemoryPanelCollapsed(false);
            } else if (direction === 'close' && deltaX > threshold) {
                setMemoryPanelCollapsed(true);
            }
        }

        setDragTarget(null);
        dragRef.current = null;
    }, []);

    const isSidebarOpen = !chatListCollapsed || !memoryPanelCollapsed;

    return (
        <div
            className={styles.appContainer}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
        >
            {/* Sidebar de Navegação */}
            <ChatList
                activeChatToken={activeChatToken}
                onSelectChat={handleSelectChat}
                onNewChat={handleNewChat}
                isCreating={isCreatingChat}
                collapsed={chatListCollapsed}
                onToggleCollapse={() => setChatListCollapsed(prev => !prev)}
                sidebarRef={chatListRef}
                isDragOpen={dragTarget === 'chatlist'}
            />

            {/* Backdrop blur — always rendered on mobile, visibility via CSS class */}
            <div
                ref={backdropRef}
                className={`${styles.backdrop} ${isSidebarOpen ? styles.backdropVisible : ''}`}
                onClick={handleBackdropClick}
            />

            {/* Área Principal */}
            <main className={styles.mainContent}>
                {activeChatToken ? (
                    <ChatView
                        key={activeChatToken}
                        chatToken={activeChatToken}
                        memoryPanelCollapsed={memoryPanelCollapsed}
                        onToggleMemoryPanel={() => setMemoryPanelCollapsed(prev => !prev)}
                        memoryPanelRef={memoryPanelRef}
                    />
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
