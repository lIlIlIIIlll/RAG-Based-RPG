const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");

const USERS_DIR = path.join(process.cwd(), "data/users");

// Ensure users directory exists
if (!fsSync.existsSync(USERS_DIR)) {
    fsSync.mkdirSync(USERS_DIR, { recursive: true });
}

/**
 * Finds a user by email.
 * @param {string} email 
 * @returns {Promise<object|null>}
 */
async function findUserByEmail(email) {
    try {
        const files = await fs.readdir(USERS_DIR);
        for (const file of files) {
            if (!file.endsWith(".json")) continue;

            const content = await fs.readFile(path.join(USERS_DIR, file), "utf-8");
            const user = JSON.parse(content);
            if (user.email === email) {
                return user;
            }
        }
        return null;
    } catch (error) {
        console.error("Error finding user by email:", error);
        throw error;
    }
}

/**
 * Finds a user by ID.
 * @param {string} id 
 * @returns {Promise<object|null>}
 */
async function findUserById(id) {
    const filePath = path.join(USERS_DIR, `${id}.json`);
    try {
        const content = await fs.readFile(filePath, "utf-8");
        return JSON.parse(content);
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
}

/**
 * Creates a new user.
 * @param {object} userData 
 * @returns {Promise<object>}
 */
async function createUser({ name, email, password }) {
    const existingUser = await findUserByEmail(email);
    if (existingUser) {
        throw new Error("User already exists");
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const id = uuidv4();

    const newUser = {
        id,
        name,
        email,
        password: hashedPassword,
        createdAt: new Date().toISOString()
    };

    await fs.writeFile(path.join(USERS_DIR, `${id}.json`), JSON.stringify(newUser, null, 2));

    // Return user without password
    const { password: _, ...userWithoutPassword } = newUser;
    return userWithoutPassword;
}

/**
 * Validates user credentials.
 * @param {string} email 
 * @param {string} password 
 * @returns {Promise<object|null>}
 */
async function validateUser(email, password) {
    const user = await findUserByEmail(email);
    if (!user) return null;

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return null;

    const { password: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
}

module.exports = {
    createUser,
    validateUser,
    findUserById
};
