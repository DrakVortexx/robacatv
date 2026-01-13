const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', 'data', 'app.db');
const db = new Database(dbPath);

// Initialize schema
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  game_state TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

module.exports = {
  getUser: (username) => {
    return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  },
  createUser: (username, passwordHash, gameState) => {
    return db.prepare('INSERT INTO users (username, password_hash, game_state) VALUES (?, ?, ?)').run(username, passwordHash, JSON.stringify(gameState));
  },
  updateGameState: (username, gameState) => {
    return db.prepare('UPDATE users SET game_state = ? WHERE username = ?').run(JSON.stringify(gameState), username);
  },
  upsertUser: (username, passwordHash, gameState) => {
    // Insert or update existing user
    return db.prepare(`
      INSERT INTO users (username, password_hash, game_state)
      VALUES (?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash, game_state=excluded.game_state
    `).run(username, passwordHash, JSON.stringify(gameState));
  },
  close: () => db.close()
};
