const socket = io();

let clientId = null;
let arena = { width: 800, height: 600 };

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const nameInput = document.getElementById('name');
const setNameBtn = document.getElementById('setName');

function resize() {
  canvas.width = Math.min(window.innerWidth, arena.width);
  canvas.height = Math.min(window.innerHeight - 40, arena.height);
}
window.addEventListener('resize', resize);

const input = { up:false,down:false,left:false,right:false };
window.addEventListener('keydown', (e) => {
  if (e.key === 'w' || e.key === 'ArrowUp') input.up = true;
  if (e.key === 's' || e.key === 'ArrowDown') input.down = true;
  if (e.key === 'a' || e.key === 'ArrowLeft') input.left = true;
  if (e.key === 'd' || e.key === 'ArrowRight') input.right = true;
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'w' || e.key === 'ArrowUp') input.up = false;
  if (e.key === 's' || e.key === 'ArrowDown') input.down = false;
  if (e.key === 'a' || e.key === 'ArrowLeft') input.left = false;
  if (e.key === 'd' || e.key === 'ArrowRight') input.right = false;
});

setNameBtn.addEventListener('click', () => {
  const n = nameInput.value.trim();
  if (n) socket.emit('setName', n);
});

socket.on('connect', () => { statusEl.textContent = 'Connected'; });
socket.on('disconnect', () => { statusEl.textContent = 'Disconnected'; });

socket.on('init', (data) => {
  clientId = data.id;
  arena = data.arena || arena;
  resize();
});

let lastState = null;
socket.on('state', (state) => { lastState = state; });

// send input at 20 TPS
setInterval(() => { socket.emit('input', input); }, 50);

function draw() {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  if (!lastState) {
    ctx.fillStyle = '#333'; ctx.fillRect(0,0,canvas.width,canvas.height);
    requestAnimationFrame(draw); return;
  }

  // scale to view (simple center on arena)
  const scale = Math.min(canvas.width / arena.width, canvas.height / arena.height);
  ctx.save();
  ctx.scale(scale, scale);

  // background
  ctx.fillStyle = '#dfe7f2'; ctx.fillRect(0,0,arena.width,arena.height);

  // brains
  for (const b of lastState.brains){
    ctx.beginPath(); ctx.fillStyle = b.owner ? '#ff6' : '#8b4'; ctx.arc(b.x, b.y, 12, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#333'; ctx.stroke();
  }

  // players
  for (const p of lastState.players){
    const isMe = p.id === clientId;
    ctx.beginPath(); ctx.fillStyle = isMe ? '#2a9' : '#69a'; ctx.arc(p.x, p.y, 18, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#222'; ctx.stroke();
    // name
    ctx.fillStyle = '#111'; ctx.font = '14px sans-serif'; ctx.fillText(p.name, p.x - 20, p.y - 24);
    // score
    ctx.fillStyle = '#000'; ctx.fillText('⭐ ' + p.score, p.x - 20, p.y + 36);
  }

  ctx.restore();

  // scoreboard
  ctx.fillStyle = '#000'; ctx.font = '14px sans-serif';
  const sorted = lastState.players.slice().sort((a,b)=>b.score-a.score);
  let y = 18;
  for (let i=0;i<Math.min(6, sorted.length); i++){
    const p = sorted[i];
    ctx.fillText(`${p.name}: ${p.score}`, 10, y); y += 18;
  }

  requestAnimationFrame(draw);
}

requestAnimationFrame(draw);
