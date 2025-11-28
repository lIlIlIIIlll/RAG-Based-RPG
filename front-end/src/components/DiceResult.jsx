import React from 'react';
import styles from './DiceResult.module.css';

const DiceResult = ({ resultString }) => {
    // Parse string: "1d20 = 20 { 20 }"
    // Regex to capture: (Expression) = (Total) { (Results) }
    const regex = /^(.*?) = (.*?) \{ (.*?) \}$/;
    const match = resultString.match(regex);

    if (!match) return <span>{resultString}</span>;

    const [_, expression, total, rollsStr] = match;
    const rolls = rollsStr.split(',').map(r => r.trim());

    // Determine die type from expression for styling (e.g. crit detection)
    const isD20 = expression.includes('d20');
    const isFudge = expression.includes('dF');

    return (
        <div className={styles.diceResultContainer}>
            <div className={styles.header}>
                <span className={styles.expression}>{expression}</span>
                <span className={styles.total}>{total}</span>
            </div>
            <div className={styles.diceRow}>
                {rolls.map((roll, idx) => {
                    let className = styles.die;

                    if (isD20) {
                        if (roll === '20') className += ` ${styles.critSuccess}`;
                        if (roll === '1') className += ` ${styles.critFail}`;
                    }

                    if (isFudge) {
                        className += ` ${styles.dieFudge}`;
                        if (roll === '+') className += ` ${styles.plus}`;
                        if (roll === '-') className += ` ${styles.minus}`;
                        if (roll === '') className += ` ${styles.blank}`; // Empty string for blank face if needed, but usually it's space
                    }

                    return (
                        <div key={idx} className={className} title={`Roll ${idx + 1}`}>
                            {roll}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default DiceResult;
