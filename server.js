const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

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
    socket.on('join', (userData) => {
        // Create player entity
        players[socket.id] = {
            id: socket.id,
            username: userData.username,
            x: Math.random() * 500, // Spawn in a "hub" area
            y: Math.random() * 500,
            color: '#' + Math.floor(Math.random()*16777215).toString(16),
            basePos: getSafeBasePosition()
        };

        // Initialize base if not exists
        if (!bases[userData.username]) {
            bases[userData.username] = [];
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
