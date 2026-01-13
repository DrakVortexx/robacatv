const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./server/db');

app.use(express.json());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Explicit route for root to ensure index.html is served
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function defaultGameState(username) {
    return {
        username,
        money: 100,
        cats: [],
        upgrades: { luck: 1, capacity: 1 },
        startTime: Date.now()
    };
}

app.post('/api/auth', async (req, res) => {
    try {
        const { username, password } = req.body || {};
        if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });

        const u = db.getUser(username);
        if (u) {
            const ok = await bcrypt.compare(password, u.password_hash);
            if (!ok) return res.status(401).json({ error: 'Invalid password' });
            const gs = u.game_state ? JSON.parse(u.game_state) : defaultGameState(username);
            return res.json({ status: 'logged_in', gameState: gs });
        } else {
            const hash = await bcrypt.hash(password, 10);
            const gs = defaultGameState(username);
            db.createUser(username, hash, gs);
            return res.json({ status: 'registered', gameState: gs });
        }
    } catch (e) {
        console.error('Auth error', e);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/save', async (req, res) => {
    try {
        const { username, gameState } = req.body || {};
        if (!username || !gameState) return res.status(400).json({ error: 'Missing data' });
        const u = db.getUser(username);
        if (!u) return res.status(404).json({ error: 'User not found' });
        db.updateGameState(username, gameState);
        bases[username] = gameState.cats || [];
        res.json({ ok: true });
    } catch (e) {
        console.error('Save error', e);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/load', async (req, res) => {
    try {
        const username = req.query.username;
        if (!username) return res.status(400).json({ error: 'Missing username' });
        const u = db.getUser(username);
        if (!u) return res.status(404).json({ error: 'Not found' });
        res.json({ gameState: u.game_state ? JSON.parse(u.game_state) : defaultGameState(username) });
    } catch (e) {
        console.error('Load error', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// Game State
const players = {};
const bases = {}; // Stores cats in each player's base
const basesLockedUntil = {}; // username -> timestamp (ms)
const pendingSteals = {}; // id -> { thiefName, victimName, cat, timer }
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
                const u = db.getUser(userData.username);
                const gs = u && u.game_state ? JSON.parse(u.game_state) : null;
                cats = gs && gs.cats ? gs.cats : [];
            } catch (e) { console.error('Error reading user for join', e); }
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

        // Check lock
        const lockedUntil = basesLockedUntil[targetUsername] || 0;
        if (Date.now() < lockedUntil) {
            const remain = Math.ceil((lockedUntil - Date.now()) / 1000);
            socket.emit('stealFailed', `Base locked for ${remain}s`);
            return;
        }

        const targetBaseCats = bases[targetUsername];
        if (!targetBaseCats || targetBaseCats.length === 0) {
            socket.emit('stealFailed', 'No cats to steal!');
            return;
        }

        // Pop one cat and create a pending steal awaiting victim response
        const stolenCat = targetBaseCats.pop();
        const id = Date.now().toString() + Math.floor(Math.random()*1000).toString();
        pendingSteals[id] = { thiefName: thief.username, victimName: targetUsername, cat: stolenCat };

        // Generate a simple 1-digit positive math question (sum 1..9)
        let a, b, s;
        do {
            a = Math.floor(Math.random() * 10);
            b = Math.floor(Math.random() * 10);
            s = a + b;
        } while (s < 1 || s > 9);

        // Send incomingSteal event to victim with the question and pending id
        // Find victim socket id
        let victimSocketId = null;
        for (const [sid, p] of Object.entries(players)) {
            if (p.username === targetUsername) { victimSocketId = sid; break; }
        }

        if (victimSocketId) {
            pendingSteals[id].correctAnswer = s;
            io.to(victimSocketId).emit('incomingSteal', { id, thiefName: thief.username, question: `${a}+${b}` });
        } else {
            // no victim socket (offline) — still store answer so server can validate if needed
            pendingSteals[id].correctAnswer = s;
        }

        // Start timeout to finalize steal in 6 seconds if not blocked
        pendingSteals[id].timer = setTimeout(() => {
            if (!pendingSteals[id]) return;
            const pending = pendingSteals[id];
            // finalize: give cat to thief
            if (!bases[pending.thiefName]) bases[pending.thiefName] = [];
            bases[pending.thiefName].push(pending.cat);
            io.emit('stealResult', {
                thiefName: pending.thiefName,
                victimName: pending.victimName,
                cat: pending.cat,
                bases: bases
            });
            delete pendingSteals[id];
        }, 6000);

        // Tell thief their steal is in progress (client already shows countdown)
        socket.emit('stealStarted', { id, victimName: targetUsername });
    });

    // Handle requests for player info (base pos + lock info)
    socket.on('requestPlayerInfo', (data) => {
        const target = data && data.targetUsername;
        if (!target) return;
        // Find the player with that username
        let targetPlayer = null;
        for (const [id, p] of Object.entries(players)) {
            if (p.username === target) { targetPlayer = p; break; }
        }
        if (targetPlayer) {
            const lockedUntil = basesLockedUntil[target] || 0;
            const catsList = bases[target] || [];
            socket.emit('playerInfo', { username: target, x: targetPlayer.basePos.x, y: targetPlayer.basePos.y, lockedUntil, cats: catsList });
        }
    });

    // Lock base for requester (costs 1000)
    socket.on('lockBase', async () => {
        const requester = players[socket.id];
        if (!requester) return;
        const username = requester.username;
        try {
            // Read stored gameState from DB
            const row = require('./server/db').getUser(username);
            if (!row) { socket.emit('lockFailed', 'User not found'); return; }
            const gs = row.game_state ? JSON.parse(row.game_state) : null;
            if (!gs) { socket.emit('lockFailed', 'No game state'); return; }
            if ((gs.money || 0) < 1000) { socket.emit('lockFailed', 'Not enough money to lock base'); return; }
            gs.money -= 1000;
            // Lock duration: 5 minutes
            const LOCK_MS = 5 * 60 * 1000;
            basesLockedUntil[username] = Date.now() + LOCK_MS;
            require('./server/db').updateGameState(username, gs);
            socket.emit('lockSuccess', { lockedUntil: basesLockedUntil[username] });
        } catch (e) {
            console.error('lockBase error', e);
            socket.emit('lockFailed', 'Server error');
        }
    });

    // Recovery mechanic removed: disables client-side recovery feature.

    // Handle teleport requests: send the base position of a target user back to the requester
    socket.on('requestTeleport', (data) => {
        const target = data && data.targetUsername;
        if (!target) return;
        // Find the player with that username
        let targetPlayer = null;
        for (const [id, p] of Object.entries(players)) {
            if (p.username === target) { targetPlayer = p; break; }
        }
        if (targetPlayer) {
            // Send base position to requester
            socket.emit('teleportTo', { x: targetPlayer.basePos.x, y: targetPlayer.basePos.y });
        }
    });

    // Victim answers incoming steal challenge
    socket.on('answerSteal', (d) => {
        const { id, answer } = d || {};
        if (!id || !pendingSteals[id]) return;
        const pending = pendingSteals[id];
        // check correctness: incomingSteal included the correct answer in event; but we didn't store it server-side
        // For security, we recompute a simple check by comparing provided answer with the one we sent (we stored it in pending)
        // We'll store correctAnswer in pending when creating pendingSteals earlier.
        if (pending.correctAnswer && Number(answer) === pending.correctAnswer) {
            // Victim answered correctly: cancel steal and return cat to victim
            clearTimeout(pending.timer);
            if (!bases[pending.victimName]) bases[pending.victimName] = [];
            bases[pending.victimName].push(pending.cat);
            // Notify everyone
            io.emit('stealBlocked', { thiefName: pending.thiefName, victimName: pending.victimName, cat: pending.cat, bases });
            delete pendingSteals[id];
        } else {
            // wrong answer: do nothing; steal will finalize on timeout
            // Optionally notify victim they failed
            socket.emit('stealAnswerWrong', { id });
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
