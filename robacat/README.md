# Robacat — multiplayer steal-a-brainrot with cats

Minimal multiplayer game using Express + Socket.IO. Players control cats (WASD/arrow keys) and try to pick up/steal brains.

Quick start

1. Install dependencies

```bash
cd /Users/student/Desktop/robacat
npm install
```

2. Start the server

```bash
npm start
```

3. Open http://localhost:3000 in several browser windows and play.

Notes

- Server emits full world state each tick (~20 TPS). This is intentionally simple to be easy to extend.
- You can change constants like arena size and speeds in `server.js`.
