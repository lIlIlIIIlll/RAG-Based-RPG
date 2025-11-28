// src/components/LoadingIndicator/LoadingIndicator.jsx
import React from 'react';
import styles from './LoadingIndicator.module.css';

/**
 * Componente que exibe uma animação de "digitando" com três pontos.
 * Usado para indicar que a IA está processando uma resposta.
 */
const LoadingIndicator = () => {
  return (
    // O container principal aplica o estilo de alinhamento e espaçamento
    <div className={styles.typingContainer}>
      {/* Cada span é um dos pontos animados */}
      <span className={styles.dot}></span>
      <span className={styles.dot}></span>
      <span className={styles.dot}></span>
    </div>
  );
};

export default LoadingIndicator;