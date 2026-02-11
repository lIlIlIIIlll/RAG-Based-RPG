import React, { useEffect, useState } from 'react';
import styles from './CinematicLoading.module.css';
import { Sparkles, Minimize2 } from 'lucide-react';

const CinematicLoading = ({ message = "Carregando...", status = 'loading', errorMessage = "", progress = 0, total = 0, onMinimize, isMinimizing, isMinimized, onMaximize }) => {
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

    if (isMinimized) {
        return (
            <div className={styles.notification} onClick={onMaximize} title="Clique para expandir">
                <div className={styles.notificationD20}>
                    <svg viewBox="0 0 100 100" className={styles.d20Svg}>
                        <path d="M 50 5 L 89 27.5 L 89 72.5 L 50 95 L 11 72.5 L 11 27.5 Z" className={styles.d20Outline} />
                        <path d="M 28 38 L 72 38 L 50 75 Z" className={styles.d20Inner} />
                        <path d="M 50 5 L 28 38" className={styles.d20Inner} />
                        <path d="M 50 5 L 72 38" className={styles.d20Inner} />
                        <path d="M 89 27.5 L 72 38" className={styles.d20Inner} />
                        <path d="M 89 72.5 L 50 75" className={styles.d20Inner} />
                        <path d="M 50 95 L 50 75" className={styles.d20Inner} />
                        <path d="M 11 72.5 L 50 75" className={styles.d20Inner} />
                        <path d="M 11 72.5 L 28 38" className={styles.d20Inner} />
                        <path d="M 11 27.5 L 28 38" className={styles.d20Inner} />
                        <text x="50" y="57" className={styles.d20Number}>{currentValue}</text>
                    </svg>
                </div>
                <div className={styles.notificationContent}>
                    <h4 className={styles.notificationTitle}>{displayMessage}</h4>
                    {total > 0 && (
                        <div className={styles.notificationProgress}>
                            <div
                                className={styles.notificationProgressFill}
                                style={{ width: `${(progress / total) * 100}%` }}
                            />
                        </div>
                    )}
                </div>
                <div className={styles.maximizeHint}>
                    <Minimize2 size={12} style={{ transform: 'rotate(180deg)' }} />
                </div>
            </div>
        );
    }

    return (
        <div className={`${styles.overlay} ${isMinimizing ? styles.minimizing : ''}`}>
            {onMinimize && (
                <button className={styles.minimizeBtn} onClick={onMinimize} title="Minimizar">
                    <Minimize2 size={24} />
                </button>
            )}
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

                    {total > 0 && (
                        <div className={styles.progressContainer}>
                            <div className={styles.progressBar}>
                                <div
                                    className={styles.progressFill}
                                    style={{ width: `${(progress / total) * 100}%`, animation: 'none' }}
                                />
                            </div>
                        </div>
                    )}

                    {status === 'loading' && total === 0 && (
                        <div className={styles.progressBar}>
                            <div className={styles.progressFill} />
                        </div>
                    )}
                </div>

                <div className={styles.particles}>
                    {[...Array(5)].map((_, i) => (
                        <Sparkles key={i} className={styles.particle} size={26} />
                    ))}
                </div>
            </div>
        </div>
    );
};

export default CinematicLoading;
