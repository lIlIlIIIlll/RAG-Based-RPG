import React, { createContext, useContext, useState, useCallback } from "react";
import ConfirmationModal from "../components/ui/ConfirmationModal";

const ConfirmationContext = createContext();

export const useConfirmation = () => useContext(ConfirmationContext);

export const ConfirmationProvider = ({ children }) => {
    const [modalState, setModalState] = useState({
        isOpen: false,
        title: "",
        message: "",
        resolve: null,
    });

    const confirm = useCallback((message, title = "Confirmação", options = {}) => {
        return new Promise((resolve) => {
            setModalState({
                isOpen: true,
                title,
                message,
                resolve,
                ...options
            });
        });
    }, []);

    const handleConfirm = () => {
        if (modalState.resolve) modalState.resolve(true);
        closeModal();
    };

    const handleCancel = () => {
        if (modalState.resolve) modalState.resolve(false);
        closeModal();
    };

    const closeModal = () => {
        setModalState((prev) => ({ ...prev, isOpen: false, resolve: null }));
    };

    return (
        <ConfirmationContext.Provider value={{ confirm }}>
            {children}
            <ConfirmationModal
                isOpen={modalState.isOpen}
                title={modalState.title}
                message={modalState.message}
                onConfirm={handleConfirm}
                onCancel={handleCancel}
                variant={modalState.variant}
                confirmIcon={modalState.confirmIcon}
                confirmLabel={modalState.confirmLabel}
            />
        </ConfirmationContext.Provider>
    );
};
