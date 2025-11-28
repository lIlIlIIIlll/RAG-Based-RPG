import React, { useState } from "react";
import { X, Check } from "lucide-react";
import styles from "./ConfigModal.module.css"; // Reusing ConfigModal styles for consistency

const ApiKeyModal = ({ onClose, onConfirm }) => {
    const [apiKey, setApiKey] = useState("");

    const handleSubmit = (e) => {
        e.preventDefault();
        if (apiKey.trim()) {
            onConfirm(apiKey.trim());
        }
    };

    return (
        <div className={styles.overlay}>
            <div className={styles.modal} style={{ maxWidth: '500px' }}>
                <div className={styles.header}>
                    <h2>Configurar API Key</h2>
                    <button onClick={onClose} className={styles.closeBtn}>
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className={styles.body}>
                    <div className={styles.field}>
                        <label>Gemini API Key</label>
                        <input
                            type="password"
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder="Cole sua API Key aqui..."
                            autoFocus
                            required
                        />
                        <span className={styles.hint}>
                            Necessária para criar o chat e processar as mensagens.
                        </span>
                    </div>

                    <div className={styles.footer} style={{ marginTop: '20px' }}>
                        <button type="button" onClick={onClose} className={styles.cancelBtn}>
                            Cancelar
                        </button>
                        <button type="submit" className={styles.saveBtn}>
                            <Check size={16} />
                            Confirmar e Importar
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default ApiKeyModal;
