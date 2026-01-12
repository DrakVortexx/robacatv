// Usage: node scripts/add_user.js <username> <password>
// This script uses bcryptjs (already a dependency) to hash a password
// and add/update the user in data/users.json with a secure hash and default gameState.

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node scripts/add_user.js <username> <password>');
    process.exit(1);
  }
  const [username, password] = args;

  const dataPath = path.join(__dirname, '..', 'data', 'users.json');
  let store = { users: {} };
  try {
    const raw = fs.readFileSync(dataPath, 'utf-8');
    store = JSON.parse(raw);
  } catch (e) {
    // file may not exist yet; we'll create it
  }

  const saltRounds = 10;
  const hash = await bcrypt.hash(password, saltRounds);

  const defaultGameState = {
    username,
    money: 0,
    cats: [],
    upgrades: { speed: 1, luck: 1, capacity: 1 },
    startTime: Date.now()
  };

  store.users = store.users || {};
  store.users[username] = {
    username: username,
    passwordHash: hash,
    gameState: defaultGameState
  };

  fs.writeFileSync(dataPath, JSON.stringify(store, null, 2), 'utf-8');
  console.log(`User '${username}' added/updated in ${dataPath}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
