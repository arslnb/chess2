# Chess 2 Online

Deployed on Railway.com

Real-time multiplayer Chess 2 — with Dragons, Shadows, Energy, Duels, and more.

## Local Development

```bash
cd online
npm install
npm start
# Open http://localhost:3000
```

## How It Works

1. One player clicks **Create Room** → gets a 6-character room code
2. Share the code (or the URL with `?room=CODE`) with your opponent
3. Opponent enters the code and joins
4. Game is fully server-authoritative — no cheating possible
5. After game over, click New Game to rematch (colors swap)

## Deploy

### Railway (easiest)
1. Push to GitHub
2. Connect repo at [railway.app](https://railway.app)
3. It auto-detects Node.js — deploys in ~60 seconds
4. Get your public URL, share it

### Fly.io
```bash
fly launch
fly deploy
```

### Render
1. New Web Service → connect repo
2. Build: `npm install`, Start: `node server.js`
3. Done

### Docker
```bash
docker build -t chess2-online .
docker run -p 3000:3000 chess2-online
```

## Features

- **Room-based matchmaking** with shareable links
- **Server-authoritative engine** — all moves validated server-side
- **Board auto-flips** for Black player
- **Spectator mode** — extra players can watch
- **All Chess 2 mechanics**: Dragon, Shadow, Energy, Cloak, King's Decree, Duels, Castling 2.0
- **Responsive** — works on mobile
- **Color swap** on rematch
- **Auto-reconnect** on disconnect
