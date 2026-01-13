// Constants & Config
const GAME_CONFIG = {
    beltSpeed: 2, // pixels per frame
    spawnRate: 60, // frames between spawns
    maxBaseCapacity: 10,
    saveInterval: 10000 // ms
};

// Brainrot Cat Definitions
const CAT_TYPES = [
    { id: 'cat_basic', name: 'Basic Cat', rarity: 'common', chance: 60, income: 1, value: 5, cost: 10, emoji: '🐱' },
    { id: 'cat_sad', name: 'Sad Cat', rarity: 'common', chance: 20, income: 2, value: 8, cost: 15, emoji: '😿' },
    { id: 'cat_happy', name: 'Happy Cat', rarity: 'common', chance: 15, income: 3, value: 12, cost: 25, emoji: '😺' },
    { id: 'cat_cool', name: 'Cool Cat', rarity: 'rare', chance: 10, income: 10, value: 50, cost: 50, emoji: '😎' },
    { id: 'cat_sus', name: 'Sus Cat', rarity: 'rare', chance: 5, income: 15, value: 100, cost: 100, emoji: '🤨' },
    { id: 'cat_sigma', name: 'Sigma Cat', rarity: 'legendary', chance: 2, income: 100, value: 1000, cost: 500, emoji: '🗿' },
    { id: 'cat_skibidi', name: 'Skibidi Cat', rarity: 'legendary', chance: 1, income: 150, value: 1500, cost: 750, emoji: '🚽' },
    { id: 'cat_omega', name: 'Omega Cat', rarity: 'mythical', chance: 0.1, income: 1000, value: 10000, cost: 5000, emoji: '🌌' }
];

// Socket.io
let socket;
if (typeof io !== 'undefined') {
    socket = io();
} else {
    console.error("Socket.io is not loaded. Multiplayer features will be disabled.");
    alert("Warning: Multiplayer server not found. You can play offline, but other players won't be visible.");
}

// Game State
let gameState = {
    username: null,
    money: 100,
    cats: [], // Cats in base
    upgrades: {
        luck: 1,
        capacity: 1
    },
    startTime: Date.now()
};

// Multiplayer State
let worldState = {
    players: {},
    selfId: null,
    bases: {}
};

let activeCats = []; // Cats on conveyor
let frameCount = 0;
let gameLoopId;
let lastTime = 0;
let isWorldView = false;

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const gameContainer = document.getElementById('game-container');
const loginBtn = document.getElementById('login-btn');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginMessage = document.getElementById('login-message');
const conveyorBelt = document.getElementById('conveyor-belt');
const baseCatsContainer = document.getElementById('base-cats');
const moneyDisplay = document.getElementById('money-display');
const incomeDisplay = document.getElementById('income-display');
const userDisplay = document.getElementById('user-display');
const upgradeLuckBtn = document.getElementById('upgrade-luck');
const upgradeCapacityBtn = document.getElementById('upgrade-capacity');
const saveBtn = document.getElementById('save-btn');
const logoutBtn = document.getElementById('logout-btn');
const toggleViewBtn = document.getElementById('toggle-view-btn');
const worldView = document.getElementById('world-view');
const baseView = document.getElementById('base-view');
const gameCanvas = document.getElementById('game-canvas');
const ctx = gameCanvas.getContext('2d');
const interactionMsg = document.getElementById('interaction-msg');
// Other player's base modal elements
const otherBaseModal = document.getElementById('other-base-modal');
const otherBaseUsername = document.getElementById('other-base-username');
const otherBaseLocked = document.getElementById('other-base-locked');
const otherBaseCats = document.getElementById('other-base-cats');
const modalTeleport = document.getElementById('modal-teleport');
const modalSteal = document.getElementById('modal-steal');
const modalRecover = document.getElementById('modal-recover');
const modalClose = document.getElementById('modal-close');
const lockBtn = document.getElementById('lock-btn');

// Resize Canvas
function resizeCanvas() {
    gameCanvas.width = window.innerWidth;
    gameCanvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Input Handling
const keys = { w: false, a: false, s: false, d: false, e: false };
window.addEventListener('keydown', (e) => {
    if (keys.hasOwnProperty(e.key.toLowerCase())) keys[e.key.toLowerCase()] = true;
});
window.addEventListener('keyup', (e) => {
    if (keys.hasOwnProperty(e.key.toLowerCase())) keys[e.key.toLowerCase()] = false;
});

// --- Account System ---

// Client no longer hashes; server handles hashing securely

async function login(username, password) {
    if (!username || !password) {
        loginMessage.textContent = "Please enter username and password.";
        loginMessage.style.color = "red";
        return;
    }
    try {
        const resp = await fetch('/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await resp.json();
        if (data.error) {
            loginMessage.textContent = data.error;
            loginMessage.style.color = 'red';
            return;
        }
        const userData = { gameState: data.gameState };
        loadGame(username, userData);
    } catch (e) {
        loginMessage.textContent = 'Server error';
        loginMessage.style.color = 'red';
    }
}

// Registration is handled by /api/auth automatically

function loadGame(username, userData) {
    gameState = userData.gameState;
    gameState.username = username;
    if (!gameState.upgrades) gameState.upgrades = { luck: 1, capacity: 1 };
    
    loginScreen.classList.add('hidden');
    gameContainer.classList.remove('hidden');
    userDisplay.textContent = username;
    
    // Connect to Multiplayer
    if (socket) {
        socket.emit('join', { username: username });
    }
    
    updateUI();
    renderBase();
    startGame();
}

async function saveGame() {
    if (!gameState.username) return;
    try {
        const resp = await fetch('/api/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: gameState.username, gameState })
        });
        const data = await resp.json();
        const originalText = saveBtn.textContent;
        saveBtn.textContent = data.ok ? 'Saved!' : 'Save Failed';
        setTimeout(() => saveBtn.textContent = originalText, 1000);
        if (socket) socket.emit('syncBase', gameState.cats);
    } catch (e) {
        console.error('Save error', e);
    }
}

function logout() {
    saveGame();
    stopGame();
    location.reload();
}

// --- Multiplayer Events ---

socket.on('init', (data) => {
    worldState.players = data.players;
    worldState.bases = data.bases;
    worldState.selfId = data.id;
});

socket.on('newPlayer', (player) => {
    // data: { username, x, y, lockedUntil, cats }
    if (!data) return;
    const lockedUntil = data.lockedUntil || 0;
    const now = Date.now();

    // Populate modal
    otherBaseUsername.textContent = `${data.username}'s Base`;
    if (lockedUntil > now) {
        const remain = Math.ceil((lockedUntil - now) / 1000);
        otherBaseLocked.textContent = `Locked for ${remain}s`;
    } else {
        otherBaseLocked.textContent = `Unlocked`;
    }

    // Fill cats
    otherBaseCats.innerHTML = '';
    const cats = data.cats || [];
    if (!cats.length) {
        otherBaseCats.textContent = 'No cats in base';
    } else {
        cats.forEach(c => {
            const d = document.createElement('div');
            d.classList.add('other-base-cat');
            d.innerHTML = `<div class="cat-emoji">${c.emoji}</div><div class="cat-name">${c.name}</div><div class="cat-value">$${c.value||0}</div>`;
            otherBaseCats.appendChild(d);
        });
    }

    // Show modal
    otherBaseModal.classList.remove('hidden');

    // Modal button actions
    modalTeleport.onclick = () => {
        const self = worldState.players[worldState.selfId];
        if (self) {
            self.x = data.x; self.y = data.y;
            if (socket) socket.emit('move', { x: self.x, y: self.y });
        }
        otherBaseModal.classList.add('hidden');
    };
    modalSteal.onclick = () => {
        if (socket) socket.emit('trySteal', data.username);
        otherBaseModal.classList.add('hidden');
    };
    modalRecover.onclick = () => {
        const thief = prompt('Enter thief username to attempt recovery from:');
        if (thief && socket) socket.emit('attemptRecover', { thiefUsername: thief });
        otherBaseModal.classList.add('hidden');
    };
    modalClose.onclick = () => { otherBaseModal.classList.add('hidden'); };
    
    if (data.thiefName === gameState.username) {
        // I stole something!
        gameState.cats.push(data.cat);
        renderBase();
        updateUI();
        saveGame();
    }
});

socket.on('stealFailed', (msg) => {
    alert(msg);
});

socket.on('playerInfo', (data) => {
    // data: { x, y, lockedUntil }
    if (!data) return;
    const lockedUntil = data.lockedUntil || 0;
    const now = Date.now();
    if (lockedUntil > now) {
        const remain = Math.ceil((lockedUntil - now) / 1000);
        if (confirm(`This base is locked for ${remain}s. Do you want to teleport to view anyway?`)) {
            // teleport to base position for view (client-side move)
            const self = worldState.players[worldState.selfId];
            if (self) {
                self.x = data.x;
                self.y = data.y;
                if (socket) socket.emit('move', { x: self.x, y: self.y });
            }
        }
    } else {
        // unlocked: ask to teleport or attempt steal
        const take = confirm('Base unlocked. Teleport to their base now? (Cancel to attempt steal)');
        if (take) {
            const self = worldState.players[worldState.selfId];
            if (self) {
                self.x = data.x;
                self.y = data.y;
                if (socket) socket.emit('move', { x: self.x, y: self.y });
            }
        } else {
            // Ask for username to steal
            const action = prompt('Type "steal" to attempt steal, or "recover" to try recover a cat from a thief you name.');
            if (action === 'steal') {
                const target = prompt('Enter the username you want to steal from (exact):');
                if (target && socket) socket.emit('trySteal', target);
            } else if (action === 'recover') {
                const thief = prompt('Enter the thief username to attempt recovery from (exact):');
                if (thief && socket) socket.emit('attemptRecover', { thiefUsername: thief });
            }
        }
    }
});

socket.on('lockSuccess', (data) => {
    const remain = Math.ceil((data.lockedUntil - Date.now()) / 1000);
    alert(`Base locked for ${remain}s`);
});

socket.on('lockFailed', (msg) => {
    alert(`Lock failed: ${msg}`);
});

socket.on('recoverResult', (data) => {
    const msg = `${data.victimName} recovered a ${data.cat.name} from ${data.thiefName}!`;
    alert(msg);
    worldState.bases = data.bases;
    if (data.victimName === gameState.username) {
        gameState.cats = worldState.bases[gameState.username] || [];
        renderBase(); updateUI(); saveGame();
    }
    if (data.thiefName === gameState.username) {
        gameState.cats = worldState.bases[gameState.username] || [];
        renderBase(); updateUI(); saveGame();
    }
});

socket.on('recoverFailed', (msg) => {
    alert(`Recover failed: ${msg}`);
});

// --- Game Logic ---

function startGame() {
    if (gameLoopId) return;
    lastTime = performance.now();
    gameLoopId = requestAnimationFrame(gameLoop);
    
    setInterval(saveGame, GAME_CONFIG.saveInterval);
    
    setInterval(() => {
        const income = calculateIncome();
        if (income > 0) {
            gameState.money += income;
            updateUI();
        }
    }, 1000);
}

function stopGame() {
    cancelAnimationFrame(gameLoopId);
    gameLoopId = null;
}

function gameLoop(timestamp) {
    const deltaTime = timestamp - lastTime;
    lastTime = timestamp;
    
    if (isWorldView) {
        updateWorld(deltaTime);
        renderWorld();
    } else {
        updateBase(deltaTime);
    }
    
    gameLoopId = requestAnimationFrame(gameLoop);
}

function updateBase(deltaTime) {
    frameCount++;
    
    // Spawn Cats
    // Spawn rate no longer affected by a speed upgrade
    const currentSpawnRate = GAME_CONFIG.spawnRate;
    if (frameCount % Math.floor(currentSpawnRate) === 0) {
        spawnCat();
    }
    
    // Move Cats
    const beltSpeed = GAME_CONFIG.beltSpeed;
    const beltWidth = conveyorBelt.offsetWidth;
    
    for (let i = activeCats.length - 1; i >= 0; i--) {
        const cat = activeCats[i];
        cat.x += beltSpeed;
        cat.element.style.left = `${cat.x}px`;
        
        if (cat.x > beltWidth) {
            cat.element.remove();
            activeCats.splice(i, 1);
        }
    }
}

function updateWorld(deltaTime) {
    const speed = 5;
    const self = worldState.players[worldState.selfId];
    
    if (self) {
        let moved = false;
        if (keys.w) { self.y -= speed; moved = true; }
        if (keys.s) { self.y += speed; moved = true; }
        if (keys.a) { self.x -= speed; moved = true; }
        if (keys.d) { self.x += speed; moved = true; }
        
        if (moved && socket) {
            socket.emit('move', { x: self.x, y: self.y });
        }
        
        // Check interactions with bases
        let nearbyBase = null;
        for (const [id, player] of Object.entries(worldState.players)) {
            if (id === worldState.selfId) continue;
            
            // Simple distance check to "player" (representing their base location for now)
            const dist = Math.hypot(player.x - self.x, player.y - self.y);
            if (dist < 50) {
                nearbyBase = player;
                break;
            }
        }
        
        if (nearbyBase) {
            interactionMsg.textContent = `Press 'E' to steal from ${nearbyBase.username}`;
            interactionMsg.classList.remove('hidden');
            
            if (keys.e && socket) {
                keys.e = false; // debounce
                socket.emit('trySteal', nearbyBase.username);
            }
        } else {
            interactionMsg.classList.add('hidden');
        }
    }
}

function renderWorld() {
    // Clear canvas
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);
    
    // Draw Grid
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    const gridSize = 50;
    const offsetX = 0; // Camera offset TODO
    const offsetY = 0;
    
    for (let x = 0; x < gameCanvas.width; x += gridSize) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, gameCanvas.height); ctx.stroke();
    }
    for (let y = 0; y < gameCanvas.height; y += gridSize) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(gameCanvas.width, y); ctx.stroke();
    }
    
    // Draw Players
    for (const [id, player] of Object.entries(worldState.players)) {
        ctx.fillStyle = player.color || '#fff';
        ctx.beginPath();
        ctx.arc(player.x, player.y, 20, 0, Math.PI * 2);
        ctx.fill();
        
        // Draw Name
        ctx.fillStyle = '#fff';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(player.username, player.x, player.y - 30);
        
        // Draw Base Indicator (Ring around player)
        if (id !== worldState.selfId) {
            ctx.strokeStyle = '#ff0000';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(player.x, player.y, 30, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    // Add click handler to canvas to detect clicks on other players
    gameCanvas.onclick = (ev) => {
        const rect = gameCanvas.getBoundingClientRect();
        const x = ev.clientX - rect.left;
        const y = ev.clientY - rect.top;

        // Find nearest player within clickable radius
        for (const [id, player] of Object.entries(worldState.players)) {
            if (id === worldState.selfId) continue;
            const dist = Math.hypot(player.x - x, player.y - y);
            if (dist < 30) {
                // Request player info (base pos + lock state)
                if (socket) {
                    socket.emit('requestPlayerInfo', { targetUsername: player.username });
                }
                break;
            }
        }
    };
}

function spawnCat() {
    const type = pickRandomCatType();
    const catElement = document.createElement('div');
    catElement.classList.add('cat', type.rarity);
    catElement.innerHTML = `<span class="cat-emoji">${type.emoji}</span><div class="cat-cost">$${type.cost}</div>`;
    
    const topOffset = Math.random() * 80 + 10;
    catElement.style.top = `${topOffset}px`;
    catElement.style.left = '-60px';
    
    const catObj = {
        id: Date.now() + Math.random(),
        type: type,
        x: -60,
        element: catElement
    };
    
    catElement.addEventListener('click', (e) => { e.stopPropagation(); buyCat(catObj); });
    
    conveyorBelt.appendChild(catElement);
    activeCats.push(catObj);
}

function buyCat(catObj) {
    const maxCapacity = GAME_CONFIG.maxBaseCapacity + (gameState.upgrades.capacity * 2);
    if (gameState.cats.length >= maxCapacity) {
        alert('Base full! Upgrade storage or sell cats.');
        return;
    }
    const cost = catObj.type.cost || 0;
    if (gameState.money < cost) {
        alert(`Not enough money to buy ${catObj.type.name}. Cost: $${cost}`);
        return;
    }
    gameState.money -= cost;
    gameState.cats.push(catObj.type);
    // Remove element from belt
    catObj.element.remove();
    activeCats = activeCats.filter(c => c.id !== catObj.id);
    renderBase();
    updateUI();
    saveGame();
}

function pickRandomCatType() {
    const luckMultiplier = 1 + (gameState.upgrades.luck * 0.1);
    let totalWeight = 0;
    const weights = CAT_TYPES.map(cat => {
        let weight = cat.chance;
        if (cat.rarity !== 'common') {
            weight *= luckMultiplier;
        }
        return weight;
    });
    
    totalWeight = weights.reduce((a, b) => a + b, 0);
    let random = Math.random() * totalWeight;
    
    for (let i = 0; i < CAT_TYPES.length; i++) {
        random -= weights[i];
        if (random <= 0) {
            return CAT_TYPES[i];
        }
    }
    return CAT_TYPES[0];
}

function stealCat(catObj) {
    const maxCapacity = GAME_CONFIG.maxBaseCapacity + (gameState.upgrades.capacity * 2);
    
    if (gameState.cats.length >= maxCapacity) {
        alert("Base full! Upgrade storage or sell cats.");
        return;
    }

    gameState.cats.push(catObj.type);
    catObj.element.remove();
    activeCats = activeCats.filter(c => c.id !== catObj.id);
    
    renderBase();
    updateUI();
    saveGame(); // Save immediately to sync
}

function calculateIncome() {
    return gameState.cats.reduce((total, cat) => total + cat.income, 0);
}

// --- UI & Rendering ---

function updateUI() {
    moneyDisplay.textContent = `$${Math.floor(gameState.money)}`;
    const income = calculateIncome();
    incomeDisplay.textContent = `$${income}/s`;
    
    const luckCost = Math.floor(500 * Math.pow(1.5, gameState.upgrades.luck));
    const capacityCost = Math.floor(1000 * Math.pow(1.5, gameState.upgrades.capacity));
    
    upgradeLuckBtn.textContent = `Luck Lvl ${gameState.upgrades.luck} ($${luckCost})`;
    upgradeCapacityBtn.textContent = `Storage Lvl ${gameState.upgrades.capacity} ($${capacityCost})`;
    
    upgradeLuckBtn.disabled = gameState.money < luckCost;
    upgradeCapacityBtn.disabled = gameState.money < capacityCost;
}

function renderBase() {
    baseCatsContainer.innerHTML = '';
    gameState.cats.forEach((cat, idx) => {
        const catDiv = document.createElement('div');
        catDiv.classList.add('base-cat', cat.rarity);
        catDiv.innerHTML = `
            <div class="cat-emoji">${cat.emoji}</div>
            <div class="cat-name">${cat.name}</div>
            <div class="cat-income">+$${cat.income}/s</div>
            <div class="cat-value">Sell: $${cat.value || 0}</div>
        `;
        // Make base cats clickable to sell
        catDiv.addEventListener('click', (e) => {
            e.stopPropagation();
            sellCat(idx);
        });
        baseCatsContainer.appendChild(catDiv);
    });
}

// Sell a cat from your base at given index
function sellCat(index) {
    const cat = gameState.cats[index];
    if (!cat) return;
    const price = cat.value || 0;
    if (!confirm(`Sell ${cat.name} for $${price}?`)) return;
    // Remove the cat and give player money
    gameState.cats.splice(index, 1);
    gameState.money += price;
    renderBase();
    updateUI();
    saveGame();
}

// --- Event Listeners ---

loginBtn.addEventListener('click', () => {
    console.log("Login button clicked"); // Debug
    login(usernameInput.value, passwordInput.value);
});

// Lock base button
if (lockBtn) {
    lockBtn.addEventListener('click', () => {
        if (!gameState.username) { alert('You must be logged in to lock your base'); return; }
        if (!socket) { alert('Multiplayer server not connected'); return; }
        socket.emit('lockBase');
    });
}

saveBtn.addEventListener('click', saveGame);
logoutBtn.addEventListener('click', logout);

toggleViewBtn.addEventListener('click', () => {
    isWorldView = !isWorldView;
    if (isWorldView) {
        toggleViewBtn.textContent = "Go Home 🏠";
        worldView.classList.remove('hidden');
        baseView.classList.add('hidden');
        resizeCanvas();
    } else {
        toggleViewBtn.textContent = "Go Outside 🌍";
        worldView.classList.add('hidden');
        baseView.classList.remove('hidden');
    }
});



upgradeLuckBtn.addEventListener('click', () => {
    const cost = Math.floor(500 * Math.pow(1.5, gameState.upgrades.luck));
    if (gameState.money >= cost) {
        gameState.money -= cost;
        gameState.upgrades.luck++;
        updateUI();
        saveGame();
    }
});

upgradeCapacityBtn.addEventListener('click', () => {
    const cost = Math.floor(1000 * Math.pow(1.5, gameState.upgrades.capacity));
    if (gameState.money >= cost) {
        gameState.money -= cost;
        gameState.upgrades.capacity++;
        updateUI();
        saveGame();
    }
});

// Initial Render
updateUI();
