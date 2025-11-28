import React from "react";
import styles from "./ConfirmationModal.module.css";

const ConfirmationModal = ({ isOpen, title, message, onConfirm, onCancel }) => {
    if (!isOpen) return null;

    return (
        <div className={styles.overlay}>
            <div className={styles.modal}>
                <div className={styles.header}>
                    <h2>{title || "Confirmação"}</h2>
                </div>
                <div className={styles.body}>
                    {message}
                </div>
                <div className={styles.footer}>
                    <button onClick={onCancel} className={styles.cancelBtn}>
                        Cancelar
                    </button>
                    <button onClick={onConfirm} className={styles.confirmBtn}>
                        Confirmar
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmationModal;
