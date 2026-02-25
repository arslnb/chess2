# Chess 2

A chess variant with new pieces, mechanics, and chaos. Play online against friends or an AI bot.

**[Play it live](https://chess2-production.up.railway.app)**

## What's Different from Regular Chess

- **Dragon** — moves like Queen + Knight. Can castle with the King.
- **Shadow** — moves like a Bishop. Can cloak (become invisible for 2 turns, costs 1 energy).
- **Energy** — both players start with 0, gain 1 per turn (max 5). Powers special abilities.
- **Duels** — 15% chance on any capture that both pieces die.
- **King's Decree** — spend 3 energy to push all adjacent enemy pieces one square away.
- **Castling 2.0** — standard castling rules, plus Dragon castling.
- **Pawn Promotion** — promotes to Queen, Rook, Bishop, Knight, or Dragon.

## How to Play

1. Go to the link above
2. **Create Room** to get a 6-character code
3. Send the code (or the URL with `?room=CODE`) to your opponent
4. Or click **Play vs Computer** to play against the AI

Game is fully server-authoritative. No cheating possible.

## Run Locally

```bash
npm install
npm start
# http://localhost:3000
```

## Deploy

Already deployed on Railway. To redeploy:

```bash
git push origin main
# Railway auto-deploys from GitHub
```

Or use Docker:

```bash
docker build -t chess2 .
docker run -p 3000:3000 chess2
```

## Tech

- Node.js + Express + WebSocket (ws)
- Server-side game engine with full move validation
- AI opponent using minimax with alpha-beta pruning (depth 3)
- Vanilla JS client with drag-and-drop

## Features

- Room-based multiplayer with shareable links
- Play vs AI bot
- Board auto-flips for Black
- Spectator mode
- Color swap on rematch
- Auto-reconnect on disconnect
- Works on mobile
