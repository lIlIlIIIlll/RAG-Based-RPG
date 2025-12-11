const userService = require("../../services/user.service");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "default_secret_key_change_me";

// Rate limiting for brute force protection
const loginAttempts = new Map(); // key: email or IP, value: { count, lastAttempt, blockedUntil }
const MAX_ATTEMPTS = 5;
const BLOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const ATTEMPT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes - reset if no attempts in this window

function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.socket?.remoteAddress || 'unknown';
}

function isBlocked(key) {
    const attempt = loginAttempts.get(key);
    if (!attempt) return false;

    // Check if block has expired
    if (attempt.blockedUntil && Date.now() < attempt.blockedUntil) {
        return true;
    }

    // Reset if block expired
    if (attempt.blockedUntil && Date.now() >= attempt.blockedUntil) {
        loginAttempts.delete(key);
        return false;
    }

    return false;
}

function recordFailedAttempt(key) {
    const now = Date.now();
    const attempt = loginAttempts.get(key) || { count: 0, firstAttempt: now };

    // Reset if window expired
    if (now - attempt.firstAttempt > ATTEMPT_WINDOW_MS) {
        attempt.count = 0;
        attempt.firstAttempt = now;
    }

    attempt.count++;
    attempt.lastAttempt = now;

    // Block if max attempts reached
    if (attempt.count >= MAX_ATTEMPTS) {
        attempt.blockedUntil = now + BLOCK_DURATION_MS;
    }

    loginAttempts.set(key, attempt);
    return attempt;
}

function clearAttempts(key) {
    loginAttempts.delete(key);
}

async function register(req, res, next) {
    try {
        const { name, email, password } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ error: "Name, email, and password are required" });
        }

        const user = await userService.createUser({ name, email, password });

        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "24h" });

        res.status(201).json({ user, token });
    } catch (error) {
        if (error.message === "User already exists") {
            return res.status(409).json({ error: "User already exists" });
        }
        next(error);
    }
}

async function login(req, res, next) {
    try {
        const { email, password } = req.body;
        const clientIP = getClientIP(req);
        const rateLimitKey = email || clientIP;

        if (!email || !password) {
            return res.status(400).json({ error: "Email and password are required" });
        }

        // Check if blocked
        if (isBlocked(rateLimitKey)) {
            const attempt = loginAttempts.get(rateLimitKey);
            const remainingMinutes = Math.ceil((attempt.blockedUntil - Date.now()) / 60000);
            return res.status(429).json({
                error: `Muitas tentativas de login. Tente novamente em ${remainingMinutes} minuto(s).`,
                blockedUntil: attempt.blockedUntil,
                retryAfter: remainingMinutes * 60
            });
        }

        const user = await userService.validateUser(email, password);
        if (!user) {
            const attempt = recordFailedAttempt(rateLimitKey);
            const remainingAttempts = MAX_ATTEMPTS - attempt.count;

            return res.status(401).json({
                error: "Credenciais inválidas",
                remainingAttempts: remainingAttempts > 0 ? remainingAttempts : 0
            });
        }

        // Clear attempts on successful login
        clearAttempts(rateLimitKey);

        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "24h" });

        res.json({ user, token });
    } catch (error) {
        next(error);
    }
}

module.exports = {
    register,
    login
};
