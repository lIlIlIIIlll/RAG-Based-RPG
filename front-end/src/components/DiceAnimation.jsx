import React, { useEffect, useState } from 'react';
import styles from './DiceAnimation.module.css';

const DiceAnimation = ({ rollData, onComplete }) => {
    const [visibleDice, setVisibleDice] = useState([]);
    const [showTotal, setShowTotal] = useState(false);
    const [isRolling, setIsRolling] = useState(true);

    useEffect(() => {
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
            setTimeout(() => {
                onComplete();
            }, 2000);

        }, 1500);

        return () => {
            clearInterval(interval);
            clearTimeout(timeout);
        };
    }, [rollData, onComplete]);

    return (
        <div className={styles.overlay}>
            <div className={styles.container}>
                <div className={styles.diceContainer}>
                    {visibleDice.map((die, idx) => (
                        <div
                            key={idx}
                            className={`${styles.die} ${isRolling ? styles.rolling : styles.landed}`}
                        >
                            {die.value}
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
