export const parseDiceCommand = (command) => {
    const regex = /^\/r\s+(\d+)d([Ff]|\d+)([\+\-]\d+)?$/;
    const match = command.trim().match(regex);

    if (!match) return null;

    const count = parseInt(match[1], 10);
    const type = match[2].toUpperCase(); // 'F' or number string
    const modifier = match[3] ? parseInt(match[3], 10) : 0;

    return { count, type, modifier };
};

export const findAndParseDiceCommand = (text) => {
    const regex = /\/r\s+(\d+)d([Ff]|\d+)([\+\-]\d+)?/;
    const match = text.match(regex);

    if (!match) return null;

    const fullCommand = match[0];
    const count = parseInt(match[1], 10);
    const type = match[2].toUpperCase();
    const modifier = match[3] ? parseInt(match[3], 10) : 0;

    return { fullCommand, count, type, modifier };
};

export const rollDice = (count, type) => {
    const rolls = [];
    let total = 0;

    for (let i = 0; i < count; i++) {
        let result;
        let value;

        if (type === 'F') {
            // Fudge/Fate dice: -1, 0, +1
            const roll = Math.floor(Math.random() * 3) - 1;
            value = roll;
            result = roll === -1 ? '-' : roll === 1 ? '+' : ' ';
        } else {
            const sides = parseInt(type, 10);
            value = Math.floor(Math.random() * sides) + 1;
            result = value;
        }

        rolls.push({ value, display: result });
        total += value;
    }

    return { rolls, total };
};

export const formatDiceResult = (count, type, modifier, total, rolls) => {
    const modString = modifier ? (modifier > 0 ? `+${modifier}` : `${modifier}`) : '';
    const rollString = rolls.map(r => r.display).join(', ');

    // Format: "4dF = +4 { +, +, +, + }" or "1d20 = 20 { 20 }"
    // If modifier exists: "1d20+5 = 25 { 20 }" (User didn't specify modifier format, but standard RPG notation usually implies showing the roll then the total)
    // User example: "1d20 = 20 { 20 }"
    // Let's stick to the user's requested format as base.
    // If modifier is present, maybe: "1d20+5 = 25 { 20 }"

    const diceExpr = `${count}d${type}${modString}`;
    const finalTotal = total + modifier;
    const totalDisplay = (finalTotal > 0 && type === 'F') ? `+${finalTotal}` : finalTotal;

    return `${diceExpr} = ${totalDisplay} { ${rollString} }`;
};
