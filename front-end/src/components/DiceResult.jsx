import React from 'react';
import styles from './DiceResult.module.css';

// Get die type from expression (e.g., "1d20" -> 20, "2d6" -> 6)
const getDieType = (expression) => {
    const match = expression.match(/d(\d+|F)/i);
    if (match) {
        return match[1].toUpperCase() === 'F' ? 'F' : parseInt(match[1], 10);
    }
    return 6; // Default to d6
};

// Map die type to CSS class
const getDieShapeClass = (dieType) => {
    switch (dieType) {
        case 4: return styles.d4;
        case 6: return styles.d6;
        case 8: return styles.d8;
        case 10: return styles.d10;
        case 12: return styles.d12;
        case 20: return styles.d20;
        case 100: return styles.d100;
        case 'F': return styles.dF;
        default: return styles.d6;
    }
};

const DiceResult = ({ resultString }) => {
    // Parse string: "1d20 = 20 { 20 }"
    // Regex to capture: (Expression) = (Total) { (Results) }
    const regex = /^(.*?) = (.*?) \{ (.*?) \}$/;
    const match = resultString.match(regex);

    if (!match) return <span>{resultString}</span>;

    const [_, expression, total, rollsStr] = match;
    const rolls = rollsStr.split(',').map(r => r.trim());
    const dieType = getDieType(expression);
    const shapeClass = getDieShapeClass(dieType);

    // Determine special states
    const isD20 = dieType === 20;
    const isFudge = dieType === 'F';

    return (
        <div className={styles.diceResultContainer}>
            <div className={styles.header}>
                <span className={styles.expression}>{expression}</span>
                <span className={styles.total}>{total}</span>
            </div>
            <div className={styles.diceRow}>
                {rolls.map((roll, idx) => {
                    let className = `${styles.die} ${shapeClass}`;

                    if (isD20) {
                        if (roll === '20') className += ` ${styles.critSuccess}`;
                        if (roll === '1') className += ` ${styles.critFail}`;
                    }

                    if (isFudge) {
                        className += ` ${styles.dieFudge}`;
                        if (roll === '+') className += ` ${styles.plus}`;
                        if (roll === '-') className += ` ${styles.minus}`;
                        if (roll === '') className += ` ${styles.blank}`;
                    }

                    return (
                        <div key={idx} className={className} title={`Roll ${idx + 1}`}>
                            <span className={styles.dieValue}>{roll}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default DiceResult;

