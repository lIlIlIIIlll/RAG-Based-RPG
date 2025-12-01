import React, { useState, useEffect } from 'react';
import { X, AlertTriangle, Trash2, Check, Database, Brain, History } from 'lucide-react';
import styles from './ConfirmationModal.module.css';

const ConfirmationModal = ({ isOpen, onClose, onConfirm, onCancel, pendingDeletions, title, message }) => {
    const [selectedIds, setSelectedIds] = useState([]);

    React.useEffect(() => {
        if (pendingDeletions) {
            setSelectedIds(pendingDeletions.map(m => m.messageid));
        } else {
            setSelectedIds([]);
        }
    }, [pendingDeletions]);

    // Fecha ao pressionar ESC
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === "Escape") {
                if (onCancel) onCancel();
                else if (onClose) onClose();
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [onClose, onCancel]);

    const handleBackdropClick = (e) => {
        if (e.target === e.currentTarget) {
            if (onCancel) onCancel();
            else if (onClose) onClose();
        }
    };

    if (!isOpen) return null;

    const toggleSelection = (id) => {
        setSelectedIds(prev =>
            prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
        );
    };

    const handleConfirm = () => {
        // Se temos pendingDeletions, passamos os IDs selecionados.
        // Se não, é uma confirmação genérica, apenas chamamos onConfirm (que pode não esperar args ou esperar true).
        if (pendingDeletions) {
            onConfirm(selectedIds);
        } else {
            onConfirm();
        }
    };

    const handleClose = () => {
        if (onCancel) onCancel();
        else if (onClose) onClose();
    };

    const getIcon = (category) => {
        switch (category?.toLowerCase()) {
            case 'fatos': return <Database size={16} />;
            case 'conceitos': return <Brain size={16} />;
            default: return <History size={16} />;
        }
    };

    return (
        <div className={styles.overlay} onClick={handleBackdropClick}>
            <div className={styles.modal}>
                <div className={styles.header}>
                    <div className={styles.title}>
                        <AlertTriangle className={styles.warningIcon} size={24} />
                        <h3>{title || "Confirmar Exclusão"}</h3>
                    </div>
                    <button onClick={handleClose} className={styles.closeBtn}>
                        <X size={20} />
                    </button>
                </div>

                <div className={styles.content}>
                    {pendingDeletions ? (
                        <>
                            <p className={styles.description}>
                                A IA solicitou a remoção das seguintes memórias. Revise e desmarque as que deseja manter.
                            </p>

                            <div className={styles.memoryList}>
                                {pendingDeletions.map((memory) => (
                                    <div
                                        key={memory.messageid}
                                        className={`${styles.memoryCard} ${selectedIds.includes(memory.messageid) ? styles.selected : styles.unselected}`}
                                        onClick={() => toggleSelection(memory.messageid)}
                                    >
                                        <div className={styles.cardHeader}>
                                            <div className={styles.categoryTag}>
                                                {getIcon(memory.category)}
                                                <span>{memory.category?.toUpperCase() || 'MEMÓRIA'}</span>
                                            </div>
                                            <div className={styles.checkbox}>
                                                {selectedIds.includes(memory.messageid) && <Check size={14} />}
                                            </div>
                                        </div>
                                        <p className={styles.cardText}>{memory.text}</p>
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : (
                        <p className={styles.description}>
                            {message || "Tem certeza que deseja realizar esta ação?"}
                        </p>
                    )}
                </div>

                <div className={styles.footer}>
                    {pendingDeletions && (
                        <div className={styles.selectionInfo}>
                            {selectedIds.length} de {pendingDeletions.length} selecionados
                        </div>
                    )}
                    <div className={styles.actions}>
                        <button onClick={handleClose} className={styles.cancelBtn}>
                            Cancelar
                        </button>
                        <button
                            onClick={handleConfirm}
                            className={styles.confirmBtn}
                            disabled={pendingDeletions && selectedIds.length === 0}
                        >
                            <Trash2 size={16} />
                            Confirmar
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ConfirmationModal;
