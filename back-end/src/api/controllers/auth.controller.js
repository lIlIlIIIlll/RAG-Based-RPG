const userService = require("../../services/user.service");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "default_secret_key_change_me";

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

        if (!email || !password) {
            return res.status(400).json({ error: "Email and password are required" });
        }

        const user = await userService.validateUser(email, password);
        if (!user) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

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
