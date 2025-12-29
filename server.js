const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

// Game state
const players = {}; // socketId -> { id, name, x, y, vx, vy, score }
const brains = []; // { id, x, y, owner: socketId|null }

const ARENA = { width: 1200, height: 800 };
const TICK_RATE = 20; // ticks per second
const PLAYER_SPEED = 220; // px per second
const PLAYER_RADIUS = 18;
const BRAIN_RADIUS = 12;

let nextBrainId = 1;

function rand(min, max) { return Math.random() * (max - min) + min; }

function spawnBrain() {
  const brain = {
    id: nextBrainId++,
    x: rand(50, ARENA.width - 50),
    y: rand(50, ARENA.height - 50),
    owner: null
  };
  brains.push(brain);
}

// Initial brains
for (let i = 0; i < 3; i++) spawnBrain();

io.on('connection', (socket) => {
  console.log('connect', socket.id);
  // create player
  players[socket.id] = {
    id: socket.id,
    name: 'Cat_' + socket.id.slice(0,4),
    x: rand(50, ARENA.width - 50),
    y: rand(50, ARENA.height - 50),
    vx: 0,
    vy: 0,
    score: 0,
    input: { up:false,down:false,left:false,right:false }
  };

  // send initial config
  socket.emit('init', { id: socket.id, arena: ARENA });

  socket.on('input', (input) => {
    if (players[socket.id]) players[socket.id].input = input;
  });

  socket.on('setName', (name) => {
    if (players[socket.id]) players[socket.id].name = String(name).slice(0,20);
  });

  socket.on('disconnect', () => {
    console.log('disconnect', socket.id);
    // transfer any owned brains back to null
    brains.forEach(b => { if (b.owner === socket.id) b.owner = null; });
    delete players[socket.id];
  });
});

function distance(a,b){
  const dx = a.x - b.x; const dy = a.y - b.y; return Math.sqrt(dx*dx + dy*dy);
}

// Simple game loop
let lastTime = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = (now - lastTime) / 1000; // seconds
  lastTime = now;

  // Update players
  for (const id in players){
    const p = players[id];
    let mx = 0, my = 0;
    if (p.input.up) my -= 1;
    if (p.input.down) my += 1;
    if (p.input.left) mx -= 1;
    if (p.input.right) mx += 1;
    // normalize
    const len = Math.hypot(mx, my) || 1;
    p.vx = (mx/len) * PLAYER_SPEED;
    p.vy = (my/len) * PLAYER_SPEED;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    // bounds
    p.x = Math.max(10, Math.min(ARENA.width - 10, p.x));
    p.y = Math.max(10, Math.min(ARENA.height - 10, p.y));
  }

  // Brain pickup/steal mechanics
  for (const brain of brains){
    // if no owner, someone can pick it up
    let nearest = null;
    let nearestDist = 1e9;
    for (const id in players){
      const p = players[id];
      const d = Math.hypot(p.x - brain.x, p.y - brain.y);
      if (d < nearestDist){ nearestDist = d; nearest = p; }
    }
    if (!nearest) continue;
    if (brain.owner === null){
      if (nearestDist <= PLAYER_RADIUS + BRAIN_RADIUS + 4){
        // pick up
        brain.owner = nearest.id;
        nearest.score += 1;
      }
    } else if (brain.owner !== nearest.id){
      // someone else collides to steal
      if (nearestDist <= PLAYER_RADIUS + BRAIN_RADIUS + 6){
        // transfer
        const prevOwner = players[brain.owner];
        brain.owner = nearest.id;
        if (prevOwner) prevOwner.score = Math.max(0, prevOwner.score - 1);
        nearest.score += 1;
      }
    }
  }

  // Occasionally spawn a new brain
  if (brains.length < 5 && Math.random() < 0.02) spawnBrain();

  // Send state to all clients
  const snapshot = {
    players: Object.values(players).map(p => ({ id: p.id, name: p.name, x: p.x, y: p.y, score: p.score })),
    brains: brains.map(b => ({ id: b.id, x: b.x, y: b.y, owner: b.owner })),
    time: Date.now()
  };
  io.emit('state', snapshot);

}, 1000 / TICK_RATE);

server.listen(PORT, () => {
  console.log(`Robacat server running on http://localhost:${PORT}`);
});
