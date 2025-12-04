// src/context/ToastContext.jsx
import React, { createContext, useContext, useState, useCallback } from "react";
import styles from "./Toast.module.css";

const ToastContext = createContext();

/**
 * Hook personalizado para usar o Toast.
 * Exemplo de uso: const { addToast } = useToast();
 */
export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast deve ser usado dentro de um ToastProvider");
  }
  return context;
};

// Ícones simples SVG
const Icons = {
  success: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
  error: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ),
  info: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
};

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const addToast = useCallback(
    ({ title, message, type = "info", duration = 4000, onClick }) => {
      const id = Date.now().toString();
      const newToast = { id, title, message, type, duration, onClick };

      setToasts((prev) => [...prev, newToast]);

      if (duration > 0) {
        setTimeout(() => {
          removeToast(id);
        }, duration);
      }
    },
    [removeToast]
  );

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}

      {/* Renderização dos Toasts (Portal seria ideal, mas aqui direto no root funciona para MVP) */}
      <div className={styles.toastContainer}>
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`${styles.toast} ${styles[toast.type]} ${toast.onClick ? styles.clickable : ''}`}
            role="alert"
            onClick={() => {
              if (toast.onClick) {
                toast.onClick();
                removeToast(toast.id);
              }
            }}
            style={toast.onClick ? { cursor: 'pointer' } : {}}
          >
            <div className={styles.icon}>
              {Icons[toast.type] || Icons.info}
            </div>

            <div className={styles.content}>
              {toast.title && <span className={styles.title}>{toast.title}</span>}
              <span className={styles.message}>{toast.message}</span>
            </div>

            <button
              className={styles.closeButton}
              onClick={(e) => {
                e.stopPropagation();
                removeToast(toast.id);
              }}
              aria-label="Fechar notificação"
            >
              ✕
            </button>

            {toast.duration > 0 && (
              <div
                className={styles.progressBar}
                style={{ animationDuration: `${toast.duration}ms` }}
              />
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};