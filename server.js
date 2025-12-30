const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

// Game state
const players = {}; // socketId -> { id, name, x, y, vx, vy, money, carrying, baseId, input }
const brains = []; // { id, x, y, type, state: 'ground'|'carried'|'stored', carriedBy, storedBy }
const bases = []; // array of base objects

const ARENA = { width: 1200, height: 800 };
const TICK_RATE = 20; // ticks per second
const PLAYER_SPEED = 220; // px per second
const PLAYER_RADIUS = 18;
const BRAIN_RADIUS = 12;

let nextBrainId = 1;

const BRAIN_TYPES = [
  { id: 'common', name: 'Tabby', color: '#8b4', income: 1, weight: 60 },
  { id: 'rare', name: 'Sphinx', color: '#6bf', income: 5, weight: 25 },
  { id: 'epic', name: 'Neon Neko', color: '#f9a', income: 18, weight: 10 },
  { id: 'legend', name: 'Catnip Overlord', color: '#ffd700', income: 60, weight: 5 }
];

function rand(min, max) { return Math.random() * (max - min) + min; }

function chooseBrainType(){
  const total = BRAIN_TYPES.reduce((s,t)=>s+t.weight,0);
  let r = Math.random()*total;
  for (const t of BRAIN_TYPES){ if (r < t.weight) return t; r -= t.weight; }
  return BRAIN_TYPES[0];
}

function spawnBrain(x,y){
  const t = chooseBrainType();
  const brain = {
    id: nextBrainId++,
    x: x ?? rand(100, ARENA.width-100),
    y: y ?? rand(100, ARENA.height-100),
    type: t,
    state: 'ground',
    carriedBy: null,
    storedBy: null
  };
  brains.push(brain);
}

// initial conveyor brains
for (let i=0;i<6;i++) spawnBrain();

// Create 8 bases placed around the arena in a circle
const BASE_COUNT = 8;
const BASE_CAPACITY = 8; // max players per base
const center = { x: ARENA.width/2, y: ARENA.height/2 };
for (let i=0;i<BASE_COUNT;i++){
  const angle = (i/BASE_COUNT) * Math.PI * 2;
  const r = Math.min(ARENA.width, ARENA.height) * 0.32;
  const bx = center.x + Math.cos(angle) * r;
  const by = center.y + Math.sin(angle) * r;
  bases.push({ id:i, x:bx, y:by, radius: 90, stored: [], shieldActive:false, shieldEnds:0, shieldCooldownEnds:0, assignedPlayers: [] });
}

io.on('connection', (socket) => {
  console.log('connect', socket.id);
  // spawn player
  // choose a base with available capacity (randomized)
  const shuffled = bases.slice().sort(()=>Math.random()-0.5);
  let assignedBase = shuffled.find(b=>b.assignedPlayers.length < BASE_CAPACITY) || bases[0];
  // spawn near assigned base within radius
  const px = assignedBase.x + rand(-assignedBase.radius+20, assignedBase.radius-20);
  const py = assignedBase.y + rand(-assignedBase.radius+20, assignedBase.radius-20);
  players[socket.id] = {
    id: socket.id,
    name: 'Cat_' + socket.id.slice(0,4),
    x: px,
    y: py,
    vx: 0,
    vy: 0,
    money: 0,
    carrying: null, // brain id
    baseId: assignedBase.id,
    input: { up:false,down:false,left:false,right:false, interact:false, shield:false }
  };
  // register player to base
  assignedBase.assignedPlayers.push(socket.id);

  // send initial config
  socket.emit('init', { id: socket.id, arena: ARENA, brainTypes: BRAIN_TYPES });

  socket.on('input', (input) => {
    const p = players[socket.id];
    if (!p) return;
    // take only known fields
    p.input.up = !!input.up;
    p.input.down = !!input.down;
    p.input.left = !!input.left;
    p.input.right = !!input.right;
    p.input.interact = !!input.interact;
    p.input.shield = !!input.shield;
  });

  socket.on('setName', (name) => {
    if (players[socket.id]) players[socket.id].name = String(name).slice(0,20);
  });

  socket.on('disconnect', () => {
    console.log('disconnect', socket.id);
    // drop carried brain to ground
    const p = players[socket.id];
    if (p && p.carrying){
      const b = brains.find(x=>x.id===p.carrying);
      if (b){ b.state='ground'; b.carriedBy=null; b.x = p.x + 20; b.y = p.y + 20; }
    }
    // transfer stored brains owned by this player back to ground and remove from bases
    if (p){
      for (const b of brains){ if (b.storedBy === socket.id){ b.state='ground'; b.storedBy = null; b.x = bases[p.baseId].x + rand(-40,40); b.y = bases[p.baseId].y + rand(-40,40); } }
      // remove from base assignedPlayers
      const base = bases[p.baseId];
      if (base){ base.assignedPlayers = base.assignedPlayers.filter(id=>id!==socket.id); base.stored = base.stored.filter(id=>{ const br = brains.find(x=>x.id===id); return br && br.storedBy !== null; }); }
    }
    delete players[socket.id];
  });
});

function dist(a,b){ const dx=a.x-b.x; const dy=a.y-b.y; return Math.hypot(dx,dy); }

// Game loop
let lastTime = Date.now();
setInterval(()=>{
  const now = Date.now();
  const dt = (now - lastTime) / 1000; lastTime = now;

  // player movement
  for (const id in players){
    const p = players[id];
    let mx=0,my=0;
    if (p.input.up) my -=1;
    if (p.input.down) my +=1;
    if (p.input.left) mx -=1;
    if (p.input.right) mx +=1;
    const len = Math.hypot(mx,my) || 1;
    p.vx = (mx/len) * PLAYER_SPEED;
    p.vy = (my/len) * PLAYER_SPEED;
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.x = Math.max(10, Math.min(ARENA.width-10, p.x));
    p.y = Math.max(10, Math.min(ARENA.height-10, p.y));

  // shield timing on player's base
  const base = bases[p.baseId];
  if (base && base.shieldActive && now > base.shieldEnds){ base.shieldActive = false; }

    // INTERACT handling (pulsed): pick up, place, steal
  if (p.input.interact){
      // 1) if carrying nothing, try pick up nearest ground brain within range
      if (!p.carrying){
        let nearest = null; let nd = 1e9;
        for (const b of brains){ if (b.state === 'ground'){ const d = Math.hypot(p.x-b.x,p.y-b.y); if (d < nd){ nd=d; nearest=b; } } }
        if (nearest && nd <= PLAYER_RADIUS + BRAIN_RADIUS + 6){
          // pick up
          nearest.state = 'carried'; nearest.carriedBy = p.id; p.carrying = nearest.id;
        }
      } else {
        // carrying something: try place into own base if near
        const myBase = bases[p.baseId];
        if (myBase && dist(p, myBase) <= myBase.radius + 6){
          // place into base
          const b = brains.find(x=>x.id===p.carrying);
          if (b){ b.state='stored'; b.storedBy = p.id; b.carriedBy = null; myBase.stored.push(b.id); p.carrying = null; }
        } else {
          // try to steal from another base if near and not shielded
          for (const otherBase of bases){ if (otherBase.id === p.baseId) continue; if (dist(p, otherBase) <= otherBase.radius + 6){
            if (!otherBase.shieldActive && otherBase.stored.length>0){
              // steal last stored brain
              const bid = otherBase.stored.pop();
              const b = brains.find(x=>x.id===bid);
              if (b){ b.storedBy = null; b.state='carried'; b.carriedBy = p.id; p.carrying = b.id; }
            }
            break;
          }}
        }
      }
    }

    // SHIELD handling (activate)
    if (p.input.shield){
      const nowt = Date.now();
      const myBase = bases[p.baseId];
      if (myBase && nowt > myBase.shieldCooldownEnds){
        myBase.shieldActive = true; myBase.shieldEnds = nowt + 8000; myBase.shieldCooldownEnds = nowt + 30000;
      }
    }

    // Income generation from stored brains owned by this player (across all bases)
    let incomeThisTick = 0;
    for (const b of brains){ if (b.state === 'stored' && b.storedBy === p.id){ incomeThisTick += b.type.income * dt; } }
    p.money += incomeThisTick;
  }

  // brains carried: update position to carrier
  for (const b of brains){ if (b.state === 'carried' && b.carriedBy){ const p = players[b.carriedBy]; if (p){ b.x = p.x + 14; b.y = p.y + 14; } else { b.state='ground'; b.carriedBy=null; } } }

  // spawn conveyor brains occasionally
  if (brains.length < 12 && Math.random() < 0.06) spawnBrain( ARENA.width/2 + rand(-120,120), 120 + rand(-40,40) );

  // Prepare snapshot
  const snapshot = {
    players: Object.values(players).map(p=>({ id:p.id, name:p.name, x:p.x, y:p.y, money: Math.floor(p.money), carrying: p.carrying, baseId: p.baseId })),
    brains: brains.map(b=>({ id:b.id, x:b.x, y:b.y, typeId: b.type.id, typeName: b.type.name, color: b.type.color, income: b.type.income, state: b.state, carriedBy: b.carriedBy, storedBy: b.storedBy })),
    bases: bases.map(b=>({ id:b.id, x:b.x, y:b.y, radius:b.radius, storedCount: b.stored.length, shieldActive: b.shieldActive, shieldCooldownEnds: b.shieldCooldownEnds })),
    time: Date.now()
  };
  io.emit('state', snapshot);

}, 1000 / TICK_RATE);

server.listen(PORT, () => {
  console.log(`Robacat server running on http://localhost:${PORT}`);
});
