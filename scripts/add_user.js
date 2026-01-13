// Usage: node scripts/add_user.js <username> <password>
// This script uses bcryptjs (already a dependency) to hash a password
// and add/update the user in data/users.json with a secure hash and default gameState.

const bcrypt = require('bcryptjs');
const db = require('../server/db');

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node scripts/add_user.js <username> <password>');
    process.exit(1);
  }
  const [username, password] = args;

  const saltRounds = 10;
  const hash = await bcrypt.hash(password, saltRounds);

  const defaultGameState = {
    username,
    money: 100,
    cats: [],
    upgrades: { luck: 1, capacity: 1 },
    startTime: Date.now()
  };

  db.upsertUser(username, hash, defaultGameState);
  console.log(`User '${username}' added/updated in SQLite DB`);
  db.close();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
