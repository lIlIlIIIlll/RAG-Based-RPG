import React from "react";
import { FileText, X, Image as ImageIcon } from "lucide-react";
import styles from "./FileCard.module.css";

const FileCard = ({ fileName, fileType, onRemove, onClick, isUploading = false }) => {
    const isPdf = fileName.toLowerCase().endsWith(".pdf");
    const isImage = /\.(jpg|jpeg|png|webp|gif)$/i.test(fileName);
    const extension = fileName.split(".").pop().toUpperCase();

    return (
        <div
            className={`${styles.card} ${onClick ? styles.clickable : ''}`}
            onClick={onClick}
            role={onClick ? "button" : undefined}
            tabIndex={onClick ? 0 : undefined}
        >
            <div className={`${styles.iconContainer} ${isPdf ? styles.pdfIcon : isImage ? styles.imageIcon : styles.genericIcon}`}>
                {isImage ? (
                    <ImageIcon size={24} color="white" />
                ) : (
                    <FileText size={24} color="white" />
                )}
            </div>
            <div className={styles.info}>
                <span className={styles.fileName} title={fileName}>
                    {fileName}
                </span>
                <span className={styles.fileType}>{extension}</span>
            </div>
            {onRemove && (
                <button
                    className={styles.removeBtn}
                    onClick={(e) => {
                        e.stopPropagation();
                        onRemove();
                    }}
                    type="button"
                >
                    <X size={14} />
                </button>
            )}
            {isUploading && (
                <div className={styles.loadingOverlay}>
                    <div className={styles.spinner}></div>
                </div>
            )}
        </div>
    );
};

export default FileCard;
