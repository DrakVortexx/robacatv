// =====================================================
// CONFIG
// =====================================================
const GAME_CONFIG = {
    beltSpeed: 2,
    spawnRate: 60,
    maxBaseCapacity: 10,
    saveInterval: 10000
};

// =====================================================
// HELPERS
// =====================================================
function randBetween(min, max) {
    return Math.random() * (max - min) + min;
}

// =====================================================
// CAT GENERATION (100, ALL GENERATED)
// =====================================================
function generateCatTypes(targetCount = 100) {

    const adjectives = [
        'Sunny','Fluffy','Bouncy','Sparkle','Cuddly','Zippy','Twinkle','Giggly',
        'Pudding','Biscuit','Noodle','Pickles','Marsh','Waffle','Button','Doodle',
        'Cheeky','Sleepy','Zoomy','Silly','Chonky','Sneaky','Grumpy','Happy'
    ];

    const nouns = [
        'Paws','Whisker','Bean','Tail','Cloud','Sprout','Pebble','Jelly',
        'Pumpkin','Mango','Berry','Toffee','Bubbles','Buddy','Muffin','Cupcake',
        'Loaf','Gremlin','Potato','Nugget','Pancake','Toast'
    ];

    const emojis = [
        '🐱','😺','😸','😻','🐈','🐾','🧶','🎩','🕶️','👑','🌟','✨','💎',
        '🍣','🍕','🎁','🎉','🚀','🌈','🔥','❄️','🌊','🌿','⚡','🌙','☀️',
        '🍀','🎃','🍁','🍒','🍇','🧸','🪁','🛸','🎧','📦','🪄','🧩','🔮'
    ];

    const rarities = [
        { name:'common',     weight:55, income:[1,5],     costMult:1 },
        { name:'uncommon',   weight:25, income:[5,15],    costMult:3 },
        { name:'rare',       weight:12, income:[20,60],   costMult:8 },
        { name:'legendary',  weight:6,  income:[100,300], costMult:25 },
        { name:'mythical',   weight:2,  income:[500,1500],costMult:80 }
    ];

    function pickRarity() {
        const total = rarities.reduce((s,r)=>s+r.weight,0);
        let roll = Math.random() * total;
        for (const r of rarities) {
            if ((roll -= r.weight) <= 0) return r;
        }
        return rarities[0];
    }

    const cats = [];

    for (let i = 0; i < targetCount; i++) {
        const r = pickRarity();
        const adj = adjectives[i % adjectives.length];
        const noun = nouns[Math.floor(i / adjectives.length) % nouns.length];

        const income = Math.floor(randBetween(r.income[0], r.income[1]));
        const cost = Math.floor(income * 10 * r.costMult);
        const value = Math.floor(cost * 0.6);

        cats.push({
            id: `cat_${i}`,
            name: `${adj} ${noun} Cat #${i + 1}`,
            rarity: r.name,
            chance: r.weight,
            income,
            cost,
            value,
            emoji: emojis[i % emojis.length]
        });
    }

    return cats;
}

const CAT_TYPES = generateCatTypes(100);

// =====================================================
// GAME STATE
// =====================================================
let gameState = {
    username: null,
    money: 100,
    cats: [],
    upgrades: { luck: 1, capacity: 1 }
};

let activeCats = [];
let frameCount = 0;
let gameLoopId = null;
let saveIntervalId = null;
let incomeIntervalId = null;

// =====================================================
// DOM
// =====================================================
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

// =====================================================
// AUTH
// =====================================================
async function login(username, password) {
    if (!username || !password) {
        loginMessage.textContent = 'Enter username and password';
        return;
    }

    const resp = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ username, password })
    });

    const data = await resp.json();
    if (data.error) {
        loginMessage.textContent = data.error;
        return;
    }

    loadGame(username, data.gameState);
}

function loadGame(username, savedState) {
    gameState = savedState || gameState;
    gameState.username = username;

    loginScreen.classList.add('hidden');
    gameContainer.classList.remove('hidden');

    updateUI();
    renderBase();
    startGame();
}

loginBtn.addEventListener('click', () => {
    login(usernameInput.value.trim(), passwordInput.value.trim());
});

// =====================================================
// GAME LOOP
// =====================================================
function startGame() {
    if (gameLoopId) return;

    saveIntervalId = setInterval(saveGame, GAME_CONFIG.saveInterval);
    incomeIntervalId = setInterval(() => {
        gameState.money += calculateIncome();
        updateUI();
    }, 1000);

    gameLoopId = requestAnimationFrame(gameLoop);
}

function gameLoop() {
    frameCount = (frameCount + 1) % 1_000_000;
    updateBase();
    gameLoopId = requestAnimationFrame(gameLoop);
}

// =====================================================
// BASE LOGIC
// =====================================================
function updateBase() {
    if (frameCount % GAME_CONFIG.spawnRate === 0) spawnCat();

    for (let i = activeCats.length - 1; i >= 0; i--) {
        const cat = activeCats[i];
        cat.x += GAME_CONFIG.beltSpeed;
        cat.el.style.left = `${cat.x}px`;

        if (cat.x > conveyorBelt.offsetWidth) {
            cat.el.remove();
            activeCats.splice(i, 1);
        }
    }
}

function pickRandomCatType() {
    const luckMult = 1 + gameState.upgrades.luck * 0.1;
    const weights = CAT_TYPES.map(c =>
        c.rarity === 'common' ? c.chance : c.chance * luckMult
    );

    let roll = Math.random() * weights.reduce((a,b)=>a+b,0);
    for (let i = 0; i < CAT_TYPES.length; i++) {
        if ((roll -= weights[i]) <= 0) return CAT_TYPES[i];
    }
    return CAT_TYPES[0];
}

function spawnCat() {
    const type = pickRandomCatType();
    const el = document.createElement('div');

    el.className = `cat ${type.rarity}`;
    el.innerHTML = `<span>${type.emoji}</span><div>$${type.cost}</div>`;
    el.style.left = '-60px';
    el.style.top = `${Math.random() * 80 + 10}px`;

    const obj = { id: Date.now() + Math.random(), type, x: -60, el };
    el.onclick = () => buyCat(obj);

    conveyorBelt.appendChild(el);
    activeCats.push(obj);
}

function buyCat(cat) {
    const cap = GAME_CONFIG.maxBaseCapacity + gameState.upgrades.capacity * 2;
    if (gameState.cats.length >= cap) return alert('Base full!');
    if (gameState.money < cat.type.cost) return;

    gameState.money -= cat.type.cost;
    gameState.cats.push(cat.type);
    cat.el.remove();
    activeCats = activeCats.filter(c => c.id !== cat.id);

    renderBase();
    updateUI();
    saveGame();
}

function sellCat(index) {
    const cat = gameState.cats[index];
    if (!cat) return;
    gameState.money += cat.value;
    gameState.cats.splice(index, 1);
    renderBase();
    updateUI();
    saveGame();
}

function calculateIncome() {
    return gameState.cats.reduce((s,c)=>s+c.income,0);
}

// =====================================================
// UI
// =====================================================
function updateUI() {
    moneyDisplay.textContent = `$${Math.floor(gameState.money)}`;
    incomeDisplay.textContent = `$${calculateIncome()}/s`;
}

function renderBase() {
    baseCatsContainer.innerHTML = '';
    gameState.cats.forEach((cat, i) => {
        const d = document.createElement('div');
        d.innerHTML = `
            <div>${cat.emoji}</div>
            <div>${cat.name}</div>
            <div>+$${cat.income}/s</div>
            <div>Sell $${cat.value}</div>
        `;
        d.onclick = () => sellCat(i);
        baseCatsContainer.appendChild(d);
    });
}

// =====================================================
// SAVE
// =====================================================
async function saveGame() {
    if (!gameState.username) return;
    fetch('/api/save', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ username: gameState.username, gameState })
    });
}

// =====================================================
// INIT (DO NOT AUTO-START GAME)
// =====================================================
updateUI();
