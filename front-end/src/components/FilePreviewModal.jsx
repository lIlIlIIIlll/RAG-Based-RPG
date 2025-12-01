import React, { useEffect } from "react";
import { X, Download } from "lucide-react";
import styles from "./FilePreviewModal.module.css";

const FilePreviewModal = ({ file, onClose }) => {
    if (!file) return null;

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

    const { name, type, url, content } = file;
    const isImage = type?.startsWith("image/") || /\.(jpg|jpeg|png|webp|gif)$/i.test(name);
    const isPdf = type === "application/pdf" || name?.toLowerCase().endsWith(".pdf");
    const isText = type === "text/plain" || name?.toLowerCase().endsWith(".txt");

    // Helper para renderizar o conteúdo
    const renderContent = () => {
        if (isImage) {
            return <img src={url} alt={name} className={styles.previewImage} />;
        }

        if (isPdf) {
            return (
                <iframe
                    src={url}
                    title={name}
                    className={styles.previewFrame}
                />
            );
        }

        if (isText) {
            return (
                <div className={styles.textPreview}>
                    <pre>{content || "Carregando conteúdo..."}</pre>
                </div>
            );
        }

        return (
            <div className={styles.genericPreview}>
                <p>Visualização não disponível para este tipo de arquivo.</p>
                <a href={url} download={name} className={styles.downloadLink}>
                    <Download size={20} />
                    Baixar Arquivo
                </a>
            </div>
        );
    };

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                <div className={styles.header}>
                    <h3 className={styles.title}>{name}</h3>
                    <div className={styles.actions}>
                        <a href={url} download={name} className={styles.iconBtn} title="Baixar">
                            <Download size={20} />
                        </a>
                        <button onClick={onClose} className={styles.iconBtn} title="Fechar">
                            <X size={20} />
                        </button>
                    </div>
                </div>
                <div className={styles.body}>
                    {renderContent()}
                </div>
            </div>
        </div>
    );
};

export default FilePreviewModal;
