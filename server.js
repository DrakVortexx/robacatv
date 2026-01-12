const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const bcrypt = require('bcryptjs');

app.use(express.json());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Explicit route for root to ensure index.html is served
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

async function ensureUsersFile() {
    try { await fsp.mkdir(DATA_DIR, { recursive: true }); } catch {}
    try {
        await fsp.access(USERS_FILE, fs.constants.F_OK);
    } catch {
        const initial = { users: {} };
        await fsp.writeFile(USERS_FILE, JSON.stringify(initial, null, 2), 'utf-8');
    }
}

async function readUsers() {
    await ensureUsersFile();
    const raw = await fsp.readFile(USERS_FILE, 'utf-8');
    try { return JSON.parse(raw); } catch { return { users: {} }; }
}

let writeQueue = Promise.resolve();
function writeUsers(data) {
    // Serialize writes to avoid corruption
    writeQueue = writeQueue.then(() => fsp.writeFile(USERS_FILE, JSON.stringify(data, null, 2), 'utf-8'));
    return writeQueue;
}

function defaultGameState(username) {
    return {
        username,
        money: 0,
        cats: [],
        upgrades: { speed: 1, luck: 1, capacity: 1 },
        startTime: Date.now()
    };
}

app.post('/api/auth', async (req, res) => {
    try {
        const { username, password } = req.body || {};
        if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });
        const store = await readUsers();
        const u = store.users[username];
        if (u) {
            const ok = await bcrypt.compare(password, u.passwordHash);
            if (!ok) return res.status(401).json({ error: 'Invalid password' });
            return res.json({ status: 'logged_in', gameState: u.gameState || defaultGameState(username) });
        } else {
            const hash = await bcrypt.hash(password, 10);
            const gs = defaultGameState(username);
            store.users[username] = { username, passwordHash: hash, gameState: gs };
            await writeUsers(store);
            return res.json({ status: 'registered', gameState: gs });
        }
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/save', async (req, res) => {
    try {
        const { username, gameState } = req.body || {};
        if (!username || !gameState) return res.status(400).json({ error: 'Missing data' });
        const store = await readUsers();
        const u = store.users[username];
        if (!u) return res.status(404).json({ error: 'User not found' });
        u.gameState = gameState;
        await writeUsers(store);
        bases[username] = gameState.cats || [];
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/load', async (req, res) => {
    try {
        const username = req.query.username;
        if (!username) return res.status(400).json({ error: 'Missing username' });
        const store = await readUsers();
        const u = store.users[username];
        if (!u) return res.status(404).json({ error: 'Not found' });
        res.json({ gameState: u.gameState });
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Game State
const players = {};
const bases = {}; // Stores cats in each player's base
const WORLD_WIDTH = 2000;
const WORLD_HEIGHT = 2000;

// Helper to get random position for new base
function getSafeBasePosition() {
    // Simple random position for now
    return {
        x: Math.floor(Math.random() * (WORLD_WIDTH - 200)),
        y: Math.floor(Math.random() * (WORLD_HEIGHT - 200))
    };
}

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Handle login / join game
    socket.on('join', async (userData) => {
        // Create player entity
        players[socket.id] = {
            id: socket.id,
            username: userData.username,
            x: Math.random() * 500, // Spawn in a "hub" area
            y: Math.random() * 500,
            color: '#' + Math.floor(Math.random()*16777215).toString(16),
            basePos: getSafeBasePosition()
        };

        if (!bases[userData.username]) {
            let cats = [];
            try {
                const store = await readUsers();
                const u = store.users[userData.username];
                cats = (u && u.gameState && u.gameState.cats) ? u.gameState.cats : [];
            } catch (_) {}
            bases[userData.username] = cats;
        }

        // Send current state to new player
        socket.emit('init', {
            id: socket.id,
            players: players,
            bases: bases,
            self: players[socket.id]
        });

        // Broadcast new player to others
        socket.broadcast.emit('newPlayer', players[socket.id]);
    });

    // Handle movement
    socket.on('move', (movementData) => {
        if (players[socket.id]) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;
            // Broadcast movement to all other players
            socket.broadcast.emit('playerMoved', {
                id: socket.id,
                x: players[socket.id].x,
                y: players[socket.id].y
            });
        }
    });

    // Handle Stealing
    socket.on('trySteal', (targetUsername) => {
        const thief = players[socket.id];
        if (!thief) return;

        const targetBaseCats = bases[targetUsername];
        if (targetBaseCats && targetBaseCats.length > 0) {
            // Steal the last cat (LIFO for simplicity)
            const stolenCat = targetBaseCats.pop();
            
            // Give to thief
            if (!bases[thief.username]) bases[thief.username] = [];
            bases[thief.username].push(stolenCat);

            // Notify everyone of the theft update
            io.emit('stealResult', {
                thiefName: thief.username,
                victimName: targetUsername,
                cat: stolenCat,
                bases: bases // In a real game, send only diffs
            });
        } else {
            socket.emit('stealFailed', 'No cats to steal!');
        }
    });

    // Handle Base Updates (e.g., from single player logic syncing up)
    // In a full secure version, the server should generate cats.
    // For this hybrid version, we trust the client to tell us when they got a cat from the belt.
    socket.on('syncBase', (cats) => {
        if (players[socket.id]) {
            bases[players[socket.id].username] = cats;
            socket.broadcast.emit('baseUpdate', {
                username: players[socket.id].username,
                cats: cats
            });
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
