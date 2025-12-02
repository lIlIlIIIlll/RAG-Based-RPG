import React, { useEffect, useState } from 'react';
import styles from './CinematicLoading.module.css';
import { Sparkles } from 'lucide-react';

const CinematicLoading = ({ message = "Carregando...", status = 'loading', errorMessage = "" }) => {
    const [displayMessage, setDisplayMessage] = useState(message);
    const [currentValue, setCurrentValue] = useState('?');

    useEffect(() => {
        if (status === 'error' && errorMessage) {
            setDisplayMessage(errorMessage);
        } else {
            setDisplayMessage(message);
        }
    }, [status, message, errorMessage]);

    useEffect(() => {
        let interval;
        // Continue rolling during loading AND anticipation states
        if (status === 'loading' || status === 'anticipate-success' || status === 'anticipate-error') {
            interval = setInterval(() => {
                setCurrentValue(Math.floor(Math.random() * 20) + 1);
            }, 80);
        } else if (status === 'success') {
            setCurrentValue(20);
        } else if (status === 'error') {
            setCurrentValue(1);
        }

        return () => clearInterval(interval);
    }, [status]);

    return (
        <div className={styles.overlay}>
            <div className={styles.content}>
                <div className={`${styles.d20Container} ${styles[status]}`}>
                    <svg viewBox="0 0 100 100" className={styles.d20Svg}>
                        {/* Outer Hexagon */}
                        <path d="M 50 5 L 89 27.5 L 89 72.5 L 50 95 L 11 72.5 L 11 27.5 Z" className={styles.d20Outline} />

                        {/* Inner Triangle */}
                        <path d="M 28 38 L 72 38 L 50 75 Z" className={styles.d20Inner} />

                        {/* Connectors */}
                        <path d="M 50 5 L 28 38" className={styles.d20Inner} />
                        <path d="M 50 5 L 72 38" className={styles.d20Inner} />
                        <path d="M 89 27.5 L 72 38" className={styles.d20Inner} />
                        <path d="M 89 72.5 L 72 38" className={styles.d20Inner} />
                        <path d="M 89 72.5 L 50 75" className={styles.d20Inner} />
                        <path d="M 50 95 L 50 75" className={styles.d20Inner} />
                        <path d="M 11 72.5 L 50 75" className={styles.d20Inner} />
                        <path d="M 11 72.5 L 28 38" className={styles.d20Inner} />
                        <path d="M 11 27.5 L 28 38" className={styles.d20Inner} />

                        <text x="50" y="57" className={styles.d20Number}>
                            {currentValue}
                        </text>
                    </svg>
                    <div className={styles.d20Glow} />
                </div>

                <div className={styles.textContainer}>
                    <h2 className={`${styles.title} ${status === 'error' ? styles.errorText : ''}`}>
                        {displayMessage}
                    </h2>
                    {status === 'loading' && (
                        <div className={styles.progressBar}>
                            <div className={styles.progressFill} />
                        </div>
                    )}
                </div>

                <div className={styles.particles}>
                    {[...Array(5)].map((_, i) => (
                        <Sparkles key={i} className={styles.particle} size={16} />
                    ))}
                </div>
            </div>
        </div>
    );
};

export default CinematicLoading;
