// Usage: node scripts/migrate_users.js
// Reads data/users.json (if present) and upserts each user into SQLite DB

const fs = require('fs');
const path = require('path');
const db = require('../server/db');

function main() {
  const dataPath = path.join(__dirname, '..', 'data', 'users.json');
  if (!fs.existsSync(dataPath)) {
    console.log('No data/users.json found — nothing to migrate.');
    process.exit(0);
  }

  const raw = fs.readFileSync(dataPath, 'utf-8');
  let store = {};
  try {
    store = JSON.parse(raw);
  } catch (e) {
    console.error('Failed to parse users.json', e);
    process.exit(1);
  }

  const users = store.users || {};
  const names = Object.keys(users);
  if (!names.length) {
    console.log('No users to migrate.');
    process.exit(0);
  }

  for (const username of names) {
    const u = users[username];
    const passwordHash = u.passwordHash || '';
    const gameState = u.gameState || { username, money: 0, cats: [], upgrades: { speed:1, luck:1, capacity:1 }, startTime: Date.now() };
    try {
      db.upsertUser(username, passwordHash, gameState);
      console.log('Migrated:', username);
    } catch (e) {
      console.error('Failed to migrate', username, e);
    }
  }

  db.close();
  console.log('Migration complete.');
}

main();
