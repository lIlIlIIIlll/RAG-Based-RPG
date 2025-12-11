import React, { useEffect, useState } from 'react';
import styles from './DiceAnimation.module.css';

// Map dice type to CSS class
const getDiceShapeClass = (diceType) => {
    const type = parseInt(diceType, 10);
    switch (type) {
        case 4: return styles.d4;
        case 6: return styles.d6;
        case 8: return styles.d8;
        case 10: return styles.d10;
        case 12: return styles.d12;
        case 20: return styles.d20;
        case 100: return styles.d100;
        default: return styles.d6; // Fallback to cube
    }
};

const DiceAnimation = ({ rollData, onComplete }) => {
    const [visibleDice, setVisibleDice] = useState([]);
    const [showTotal, setShowTotal] = useState(false);
    const [isRolling, setIsRolling] = useState(true);

    useEffect(() => {
        let completeTimeout = null;

        // Initialize dice with random values
        const initialDice = rollData.rolls.map(() => ({
            value: '?',
            isLanded: false
        }));
        setVisibleDice(initialDice);

        // Start rolling animation logic
        const interval = setInterval(() => {
            setVisibleDice(prev => prev.map(d => {
                if (d.isLanded) return d;
                // Randomize value while rolling
                let randomVal;
                if (rollData.type === 'F') {
                    const opts = ['+', '-', ' '];
                    randomVal = opts[Math.floor(Math.random() * opts.length)];
                } else {
                    const max = parseInt(rollData.type, 10);
                    randomVal = Math.floor(Math.random() * max) + 1;
                }
                return { ...d, value: randomVal };
            }));
        }, 80);

        // Stop rolling after a delay
        const timeout = setTimeout(() => {
            clearInterval(interval);
            setIsRolling(false);

            // Reveal actual results
            setVisibleDice(rollData.rolls.map(r => ({
                value: r.display,
                isLanded: true
            })));

            setShowTotal(true);

            // Close after showing result
            completeTimeout = setTimeout(() => {
                onComplete();
            }, 2000);

        }, 1500);

        return () => {
            clearInterval(interval);
            clearTimeout(timeout);
            if (completeTimeout) clearTimeout(completeTimeout);
        };
    }, [rollData, onComplete]);

    const shapeClass = getDiceShapeClass(rollData.type);

    return (
        <div className={styles.overlay}>
            <div className={styles.container}>
                <div className={styles.diceLabel}>
                    {rollData.notation}
                </div>
                <div className={styles.diceContainer}>
                    {visibleDice.map((die, idx) => (
                        <div
                            key={idx}
                            className={`${styles.die} ${shapeClass} ${isRolling ? styles.rolling : styles.landed}`}
                        >
                            <span className={styles.dieValue}>{die.value}</span>
                        </div>
                    ))}
                </div>

                {showTotal && (
                    <div className={styles.totalResult}>
                        {rollData.total + (rollData.modifier || 0)}
                    </div>
                )}
            </div>
        </div>
    );
};

export default DiceAnimation;

