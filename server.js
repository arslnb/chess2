// Chess 2 Online — WebSocket multiplayer server with AI bot
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

// ============ CHESS 2 ENGINE (server-authoritative) ============
const EMPTY = 0, PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6, DRAGON = 7, SHADOW = 8;
const WHITE = 1, BLACK = 2;
const PIECE_NAMES = ['','Pawn','Knight','Bishop','Rook','Queen','King','Dragon','Shadow'];

function opponent(c) { return c === WHITE ? BLACK : WHITE; }
function inBounds(r,c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }

function createGame() {
  const board = Array.from({length:8}, () => Array.from({length:8}, () => ({type:EMPTY, color:0})));
  const backRankBlack = [ROOK, SHADOW, BISHOP, DRAGON, QUEEN, KING, BISHOP, KNIGHT];
  const backRankWhite = [ROOK, KNIGHT, BISHOP, QUEEN, KING, DRAGON, BISHOP, SHADOW];
  for (let c = 0; c < 8; c++) {
    board[0][c] = { type: backRankBlack[c], color: BLACK };
    board[1][c] = { type: PAWN, color: BLACK };
    board[6][c] = { type: PAWN, color: WHITE };
    board[7][c] = { type: backRankWhite[c], color: WHITE };
  }
  return {
    board,
    turn: WHITE,
    moveCount: 1,
    energy: { [WHITE]: 1, [BLACK]: 1 },
    gameOver: false,
    winner: null,
    enPassant: null,
    cloaked: { [WHITE]: null, [BLACK]: null },
    cloakTurnsLeft: { [WHITE]: 0, [BLACK]: 0 },
    castleRights: {
      [WHITE]: { kMoved: false, lrMoved: false, rrMoved: false, ldMoved: false, rdMoved: false },
      [BLACK]: { kMoved: false, lrMoved: false, rrMoved: false, ldMoved: false, rdMoved: false }
    },
    log: []
  };
}

function cloneGame(g) {
  return JSON.parse(JSON.stringify(g));
}

function isEmpty_(board, r, c) { return board[r][c].type === EMPTY; }
function isEnemy_(board, r, c, color) { return board[r][c].type !== EMPTY && board[r][c].color !== color; }
function isFriendly_(board, r, c, color) { return board[r][c].type !== EMPTY && board[r][c].color === color; }

function addIfValid_(board, moves, r, c, fromR, fromC, color) {
  if (!inBounds(r,c)) return false;
  if (isFriendly_(board, r, c, color)) return false;
  moves.push({r,c});
  return isEmpty_(board, r, c);
}

function getSlidingMoves_(board, r, c, color, dirs, maxDist = 8) {
  const moves = [];
  for (const [dr,dc] of dirs) {
    for (let i = 1; i <= maxDist; i++) {
      const nr = r + dr * i, nc = c + dc * i;
      if (!addIfValid_(board, moves, nr, nc, r, c, color)) break;
    }
  }
  return moves;
}

function getRawMoves_(board, r, c, enPassant, castleRights) {
  const piece = board[r][c];
  if (piece.type === EMPTY) return [];
  const color = piece.color;
  const moves = [];
  const diagDirs = [[-1,-1],[-1,1],[1,-1],[1,1]];
  const straightDirs = [[-1,0],[1,0],[0,-1],[0,1]];
  const allDirs = [...diagDirs, ...straightDirs];

  switch (piece.type) {
    case PAWN: {
      const dir = color === WHITE ? -1 : 1;
      const startRow = color === WHITE ? 6 : 1;
      if (inBounds(r+dir,c) && isEmpty_(board, r+dir,c)) {
        moves.push({r:r+dir, c});
        if (r === startRow && isEmpty_(board, r+2*dir,c)) moves.push({r:r+2*dir, c});
      }
      for (const dc of [-1,1]) {
        if (inBounds(r+dir,c+dc)) {
          if (isEnemy_(board, r+dir,c+dc,color)) moves.push({r:r+dir, c:c+dc});
          if (enPassant && enPassant.r === r+dir && enPassant.c === c+dc) moves.push({r:r+dir, c:c+dc, enPassant: true});
        }
      }
      break;
    }
    case KNIGHT: {
      for (const [dr,dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
        addIfValid_(board, moves, r+dr, c+dc, r, c, color);
      }
      break;
    }
    case BISHOP: return getSlidingMoves_(board, r, c, color, diagDirs);
    case ROOK: return getSlidingMoves_(board, r, c, color, straightDirs);
    case QUEEN: return getSlidingMoves_(board, r, c, color, allDirs);
    case KING: {
      for (const [dr,dc] of allDirs) addIfValid_(board, moves, r+dr, c+dc, r, c, color);
      const cr = castleRights[color];
      const row = color === WHITE ? 7 : 0;
      if (!cr.kMoved && r === row) {
        const kc = c;
        if (!cr.rrMoved && board[row][7].type === ROOK && board[row][7].color === color) {
          if (isEmpty_(board, row,5) && isEmpty_(board, row,6)) {
            moves.push({r:row, c:kc+2, castle:'k'});
          }
        }
        if (!cr.lrMoved && board[row][0].type === ROOK && board[row][0].color === color) {
          if (isEmpty_(board, row,1) && isEmpty_(board, row,2) && isEmpty_(board, row,3)) {
            moves.push({r:row, c:kc-2, castle:'q'});
          }
        }
        for (let dc2 = 0; dc2 < 8; dc2++) {
          if (board[row][dc2].type === DRAGON && board[row][dc2].color === color) {
            if (dc2 > kc) {
              let clear = true;
              for (let x = kc+1; x < dc2; x++) if (!isEmpty_(board, row,x)) clear = false;
              if (clear && dc2 - kc >= 2) {
                if (!cr.rdMoved) moves.push({r:row, c:kc+2, castle:'dk', dragonCol: dc2});
              }
            } else {
              let clear = true;
              for (let x = dc2+1; x < kc; x++) if (!isEmpty_(board, row,x)) clear = false;
              if (clear && kc - dc2 >= 2) {
                if (!cr.ldMoved) moves.push({r:row, c:kc-2, castle:'dq', dragonCol: dc2});
              }
            }
          }
        }
      }
      break;
    }
    case DRAGON: {
      for (const [dr,dc] of allDirs) {
        let leaped = false;
        for (let i = 1; i <= 3; i++) {
          const nr = r + dr*i, nc = c + dc*i;
          if (!inBounds(nr,nc)) break;
          if (isFriendly_(board, nr,nc,color)) {
            if (!leaped) { leaped = true; continue; }
            else break;
          }
          if (isEnemy_(board, nr,nc,color)) {
            if (!leaped) { moves.push({r:nr,c:nc}); leaped = true; continue; }
            else { moves.push({r:nr,c:nc}); break; }
          }
          moves.push({r:nr,c:nc});
        }
      }
      break;
    }
    case SHADOW: {
      for (const [dr,dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
        addIfValid_(board, moves, r+dr, c+dc, r, c, color);
      }
      for (const [dr,dc] of diagDirs) {
        addIfValid_(board, moves, r+dr, c+dc, r, c, color);
      }
      break;
    }
  }
  return moves;
}

function findKing_(board, color) {
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (board[r][c].type === KING && board[r][c].color === color) return {r,c};
  return null;
}

function isSquareAttacked_(board, r, c, byColor, enPassant, castleRights) {
  for (let rr = 0; rr < 8; rr++)
    for (let cc = 0; cc < 8; cc++)
      if (board[rr][cc].color === byColor) {
        const moves = getRawMoves_(board, rr, cc, enPassant, castleRights);
        if (moves.some(m => m.r === r && m.c === c)) return true;
      }
  return false;
}

function isInCheck_(board, color, enPassant, castleRights) {
  const king = findKing_(board, color);
  if (!king) return false;
  return isSquareAttacked_(board, king.r, king.c, opponent(color), enPassant, castleRights);
}

function getLegalMoves_(board, r, c, enPassant, castleRights) {
  const raw = getRawMoves_(board, r, c, enPassant, castleRights);
  const piece = board[r][c];
  const legal = [];
  for (const move of raw) {
    const saved = board[move.r][move.c];
    const orig = board[r][c];
    let epCaptured = null, epPos = null;

    board[move.r][move.c] = orig;
    board[r][c] = {type:EMPTY, color:0};

    if (move.enPassant) {
      const epR = piece.color === WHITE ? move.r + 1 : move.r - 1;
      epCaptured = board[epR][move.c];
      epPos = {r:epR, c:move.c};
      board[epR][move.c] = {type:EMPTY, color:0};
    }

    if (move.castle) {
      const row = move.r;
      if (move.castle === 'k') {
        board[row][5] = board[row][7];
        board[row][7] = {type:EMPTY,color:0};
      } else if (move.castle === 'q') {
        board[row][3] = board[row][0];
        board[row][0] = {type:EMPTY,color:0};
      } else if (move.castle === 'dk') {
        board[row][move.c - 1] = board[row][move.dragonCol];
        board[row][move.dragonCol] = {type:EMPTY,color:0};
      } else if (move.castle === 'dq') {
        board[row][move.c + 1] = board[row][move.dragonCol];
        board[row][move.dragonCol] = {type:EMPTY,color:0};
      }
    }

    const inCheck = isInCheck_(board, piece.color, enPassant, castleRights);

    board[r][c] = orig;
    board[move.r][move.c] = saved;
    if (epPos) board[epPos.r][epPos.c] = epCaptured;
    if (move.castle) {
      const row = move.r;
      if (move.castle === 'k') {
        board[row][7] = board[row][5]; board[row][5] = {type:EMPTY,color:0};
      } else if (move.castle === 'q') {
        board[row][0] = board[row][3]; board[row][3] = {type:EMPTY,color:0};
      } else if (move.castle === 'dk') {
        board[row][move.dragonCol] = board[row][move.c-1]; board[row][move.c-1] = {type:EMPTY,color:0};
      } else if (move.castle === 'dq') {
        board[row][move.dragonCol] = board[row][move.c+1]; board[row][move.c+1] = {type:EMPTY,color:0};
      }
    }

    if (!inCheck) legal.push(move);
  }
  return legal;
}

function hasLegalMoves_(board, color, enPassant, castleRights) {
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (board[r][c].color === color && getLegalMoves_(board, r, c, enPassant, castleRights).length > 0) return true;
  return false;
}

function executeMove(game, fromR, fromC, toR, toC, moveData) {
  const board = game.board;
  const piece = board[fromR][fromC];
  const captured = board[toR][toC];
  const color = piece.color;
  const cols = 'abcdefgh';

  // Duel mechanic
  let duelResult = null;
  if (captured.type !== EMPTY && captured.type !== KING) {
    if (Math.random() < 0.15) duelResult = 'mutual';
  }

  // En passant
  if (moveData && moveData.enPassant) {
    const epR = color === WHITE ? toR + 1 : toR - 1;
    board[epR][toC] = {type:EMPTY, color:0};
    game.log.push(`${color===WHITE?'White':'Black'} pawn captures en passant!`);
  }

  if (duelResult === 'mutual') {
    board[toR][toC] = {type:EMPTY, color:0};
    board[fromR][fromC] = {type:EMPTY, color:0};
    game.log.push(`💥 DUEL! Both ${PIECE_NAMES[piece.type]} and ${PIECE_NAMES[captured.type]} are destroyed!`);
  } else {
    board[toR][toC] = piece;
    board[fromR][fromC] = {type:EMPTY, color:0};
  }

  // Castle
  if (moveData && moveData.castle) {
    const row = toR;
    if (moveData.castle === 'k') {
      board[row][5] = board[row][7]; board[row][7] = {type:EMPTY,color:0};
      game.log.push(`${color===WHITE?'White':'Black'} castles kingside`);
    } else if (moveData.castle === 'q') {
      board[row][3] = board[row][0]; board[row][0] = {type:EMPTY,color:0};
      game.log.push(`${color===WHITE?'White':'Black'} castles queenside`);
    } else if (moveData.castle === 'dk' || moveData.castle === 'dq') {
      const dc = moveData.dragonCol;
      const newDC = moveData.castle === 'dk' ? toC - 1 : toC + 1;
      board[row][newDC] = board[row][dc]; board[row][dc] = {type:EMPTY,color:0};
      game.log.push(`${color===WHITE?'White':'Black'} castles with Dragon!`);
    }
  }

  // Castle rights
  if (piece.type === KING) game.castleRights[color].kMoved = true;
  if (piece.type === ROOK) {
    const row = color === WHITE ? 7 : 0;
    if (fromC === 0 && fromR === row) game.castleRights[color].lrMoved = true;
    if (fromC === 7 && fromR === row) game.castleRights[color].rrMoved = true;
  }
  if (piece.type === DRAGON) {
    const row = color === WHITE ? 7 : 0;
    if (fromR === row) {
      if (fromC > 4) game.castleRights[color].rdMoved = true;
      else game.castleRights[color].ldMoved = true;
    }
  }

  // En passant target
  game.enPassant = null;
  if (piece.type === PAWN && Math.abs(toR - fromR) === 2) {
    game.enPassant = { r: (fromR + toR) / 2, c: fromC };
  }

  // Promotion check
  if (piece.type === PAWN && (toR === (color === WHITE ? 0 : 7))) {
    // needs promotion — return 'promotion'
    if (!duelResult) {
      const capStr = captured.type !== EMPTY ? `x${PIECE_NAMES[captured.type]} ` : '';
      game.log.push(`${color===WHITE?'⬜':'⬛'} ${PIECE_NAMES[piece.type]} ${cols[fromC]}${8-fromR}→${cols[toC]}${8-toR} ${capStr}`);
    }
    return 'promotion';
  }

  if (!duelResult && !(moveData && moveData.castle)) {
    const capStr = captured.type !== EMPTY ? `x${PIECE_NAMES[captured.type]} ` : '';
    game.log.push(`${color===WHITE?'⬜':'⬛'} ${PIECE_NAMES[piece.type]} ${cols[fromC]}${8-fromR}→${cols[toC]}${8-toR} ${capStr}`);
  }

  return null;
}

// Execute move without duel randomness and without logging (for AI search)
function executeMoveQuiet(game, fromR, fromC, toR, toC, moveData) {
  const board = game.board;
  const piece = board[fromR][fromC];
  const captured = board[toR][toC];
  const color = piece.color;

  // No duel, no log
  if (moveData && moveData.enPassant) {
    const epR = color === WHITE ? toR + 1 : toR - 1;
    board[epR][toC] = {type:EMPTY, color:0};
  }

  board[toR][toC] = piece;
  board[fromR][fromC] = {type:EMPTY, color:0};

  if (moveData && moveData.castle) {
    const row = toR;
    if (moveData.castle === 'k') {
      board[row][5] = board[row][7]; board[row][7] = {type:EMPTY,color:0};
    } else if (moveData.castle === 'q') {
      board[row][3] = board[row][0]; board[row][0] = {type:EMPTY,color:0};
    } else if (moveData.castle === 'dk' || moveData.castle === 'dq') {
      const dc = moveData.dragonCol;
      const newDC = moveData.castle === 'dk' ? toC - 1 : toC + 1;
      board[row][newDC] = board[row][dc]; board[row][dc] = {type:EMPTY,color:0};
    }
  }

  if (piece.type === KING) game.castleRights[color].kMoved = true;
  if (piece.type === ROOK) {
    const row = color === WHITE ? 7 : 0;
    if (fromC === 0 && fromR === row) game.castleRights[color].lrMoved = true;
    if (fromC === 7 && fromR === row) game.castleRights[color].rrMoved = true;
  }
  if (piece.type === DRAGON) {
    const row = color === WHITE ? 7 : 0;
    if (fromR === row) {
      if (fromC > 4) game.castleRights[color].rdMoved = true;
      else game.castleRights[color].ldMoved = true;
    }
  }

  game.enPassant = null;
  if (piece.type === PAWN && Math.abs(toR - fromR) === 2) {
    game.enPassant = { r: (fromR + toR) / 2, c: fromC };
  }

  // Auto-promote to queen for AI search
  if (piece.type === PAWN && (toR === (color === WHITE ? 0 : 7))) {
    board[toR][toC] = { type: QUEEN, color };
  }
}

function endTurn(game) {
  if (game.cloakTurnsLeft[game.turn] > 0) {
    game.cloakTurnsLeft[game.turn]--;
    if (game.cloakTurnsLeft[game.turn] === 0) {
      game.log.push(`${game.turn===WHITE?'White':'Black'} Shadow decloaks!`);
      game.cloaked[game.turn] = null;
    }
  }

  game.turn = opponent(game.turn);
  if (game.turn === WHITE) game.moveCount++;
  game.energy[game.turn] = Math.min(3, game.energy[game.turn] + 1);

  const inCheck = isInCheck_(game.board, game.turn, game.enPassant, game.castleRights);
  const hasMoves = hasLegalMoves_(game.board, game.turn, game.enPassant, game.castleRights);

  let status = '';
  if (inCheck && !hasMoves) {
    game.gameOver = true;
    game.winner = opponent(game.turn);
    status = `checkmate`;
  } else if (!hasMoves) {
    game.gameOver = true;
    status = 'stalemate';
  } else if (inCheck) {
    status = 'check';
  }

  return status;
}

// ============ AI ENGINE (minimax with alpha-beta) ============
const PIECE_VALUES = { [PAWN]:100, [KNIGHT]:320, [BISHOP]:330, [ROOK]:500, [QUEEN]:900, [KING]:20000, [DRAGON]:700, [SHADOW]:400 };

const PST_PAWN_W = [[0,0,0,0,0,0,0,0],[50,50,50,50,50,50,50,50],[10,10,20,30,30,20,10,10],[5,5,10,25,25,10,5,5],[0,0,0,20,20,0,0,0],[5,-5,-10,0,0,-10,-5,5],[5,10,10,-20,-20,10,10,5],[0,0,0,0,0,0,0,0]];
const PST_KNIGHT_W = [[-50,-40,-30,-30,-30,-30,-40,-50],[-40,-20,0,0,0,0,-20,-40],[-30,0,10,15,15,10,0,-30],[-30,5,15,20,20,15,5,-30],[-30,0,15,20,20,15,0,-30],[-30,5,10,15,15,10,5,-30],[-40,-20,0,5,5,0,-20,-40],[-50,-40,-30,-30,-30,-30,-40,-50]];
const PST_BISHOP_W = [[-20,-10,-10,-10,-10,-10,-10,-20],[-10,0,0,0,0,0,0,-10],[-10,0,10,10,10,10,0,-10],[-10,5,5,10,10,5,5,-10],[-10,0,10,10,10,10,0,-10],[-10,10,10,10,10,10,10,-10],[-10,5,0,0,0,0,5,-10],[-20,-10,-10,-10,-10,-10,-10,-20]];
const PST_ROOK_W = [[0,0,0,0,0,0,0,0],[5,10,10,10,10,10,10,5],[-5,0,0,0,0,0,0,-5],[-5,0,0,0,0,0,0,-5],[-5,0,0,0,0,0,0,-5],[-5,0,0,0,0,0,0,-5],[-5,0,0,0,0,0,0,-5],[0,0,0,5,5,0,0,0]];
const PST_QUEEN_W = [[-20,-10,-10,-5,-5,-10,-10,-20],[-10,0,0,0,0,0,0,-10],[-10,0,5,5,5,5,0,-10],[-5,0,5,5,5,5,0,-5],[0,0,5,5,5,5,0,-5],[-10,5,5,5,5,5,0,-10],[-10,0,5,0,0,0,0,-10],[-20,-10,-10,-5,-5,-10,-10,-20]];
const PST_KING_W = [[-30,-40,-40,-50,-50,-40,-40,-30],[-30,-40,-40,-50,-50,-40,-40,-30],[-30,-40,-40,-50,-50,-40,-40,-30],[-30,-40,-40,-50,-50,-40,-40,-30],[-20,-30,-30,-40,-40,-30,-30,-20],[-10,-20,-20,-20,-20,-20,-20,-10],[20,20,0,0,0,0,20,20],[20,30,10,0,0,10,30,20]];
const PST = { [PAWN]:PST_PAWN_W, [KNIGHT]:PST_KNIGHT_W, [BISHOP]:PST_BISHOP_W, [ROOK]:PST_ROOK_W, [QUEEN]:PST_QUEEN_W, [KING]:PST_KING_W, [DRAGON]:PST_QUEEN_W, [SHADOW]:PST_KNIGHT_W };

function getPST(type, color, r, c) {
  const t = PST[type];
  if (!t) return 0;
  return t[color === WHITE ? r : 7-r][c];
}

function evaluateBoard(game, aiColor) {
  const board = game.board;
  const humanColor = opponent(aiColor);
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p.type === EMPTY) continue;
      const val = PIECE_VALUES[p.type] + getPST(p.type, p.color, r, c);
      if (p.color === aiColor) score += val; else score -= val;
    }
  }
  // Mobility
  let aiMob = 0, hMob = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (board[r][c].color === aiColor) aiMob += getRawMoves_(board, r, c, game.enPassant, game.castleRights).length;
      else if (board[r][c].color === humanColor) hMob += getRawMoves_(board, r, c, game.enPassant, game.castleRights).length;
    }
  }
  score += (aiMob - hMob) * 3;
  // Energy
  score += (game.energy[aiColor] - game.energy[humanColor]) * 15;
  // Check bonuses
  if (isInCheck_(board, humanColor, game.enPassant, game.castleRights)) score += 30;
  if (isInCheck_(board, aiColor, game.enPassant, game.castleRights)) score -= 30;
  return score;
}

function getAllMovesForColor(game, color) {
  const all = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (game.board[r][c].color === color) {
        const moves = getLegalMoves_(game.board, r, c, game.enPassant, game.castleRights);
        for (const m of moves) {
          all.push({fromR:r, fromC:c, toR:m.r, toC:m.c, moveData:m});
        }
      }
    }
  }
  return all;
}

function saveGameState(game) {
  return {
    board: game.board.map(r => r.map(c => ({...c}))),
    turn: game.turn,
    energy: {...game.energy},
    enPassant: game.enPassant ? {...game.enPassant} : null,
    castleRights: { [WHITE]:{...game.castleRights[WHITE]}, [BLACK]:{...game.castleRights[BLACK]} },
    cloaked: { [WHITE]: game.cloaked[WHITE] ? {...game.cloaked[WHITE]} : null, [BLACK]: game.cloaked[BLACK] ? {...game.cloaked[BLACK]} : null },
    cloakTurnsLeft: {...game.cloakTurnsLeft},
    gameOver: game.gameOver,
    winner: game.winner,
    moveCount: game.moveCount,
    log: [...game.log]
  };
}

function restoreGameState(game, s) {
  game.board = s.board;
  game.turn = s.turn;
  game.energy = s.energy;
  game.enPassant = s.enPassant;
  game.castleRights = s.castleRights;
  game.cloaked = s.cloaked;
  game.cloakTurnsLeft = s.cloakTurnsLeft;
  game.gameOver = s.gameOver;
  game.winner = s.winner;
  game.moveCount = s.moveCount;
  game.log = s.log;
}

function orderMoves(game, moves) {
  return moves.sort((a,b) => {
    const ca = game.board[a.toR][a.toC].type !== EMPTY ? (PIECE_VALUES[game.board[a.toR][a.toC].type] || 0) : 0;
    const cb = game.board[b.toR][b.toC].type !== EMPTY ? (PIECE_VALUES[game.board[b.toR][b.toC].type] || 0) : 0;
    return cb - ca;
  });
}

function minimax(game, depth, alpha, beta, isMax, aiColor) {
  if (depth === 0) return evaluateBoard(game, aiColor);
  const color = isMax ? aiColor : opponent(aiColor);
  if (!findKing_(game.board, color)) return isMax ? -100000 : 100000;
  let moves = getAllMovesForColor(game, color);
  if (moves.length === 0) return isInCheck_(game.board, color, game.enPassant, game.castleRights) ? (isMax ? -100000-depth : 100000+depth) : 0;
  moves = orderMoves(game, moves);

  if (isMax) {
    let max = -Infinity;
    for (const m of moves) {
      const s = saveGameState(game);
      executeMoveQuiet(game, m.fromR, m.fromC, m.toR, m.toC, m.moveData);
      // Simulate turn change for search
      game.turn = opponent(game.turn);
      const v = minimax(game, depth-1, alpha, beta, false, aiColor);
      restoreGameState(game, s);
      max = Math.max(max, v);
      alpha = Math.max(alpha, v);
      if (beta <= alpha) break;
    }
    return max;
  } else {
    let min = Infinity;
    for (const m of moves) {
      const s = saveGameState(game);
      executeMoveQuiet(game, m.fromR, m.fromC, m.toR, m.toC, m.moveData);
      game.turn = opponent(game.turn);
      const v = minimax(game, depth-1, alpha, beta, true, aiColor);
      restoreGameState(game, s);
      min = Math.min(min, v);
      beta = Math.min(beta, v);
      if (beta <= alpha) break;
    }
    return min;
  }
}

const AI_DEPTH = 3;

function findBestMove(game, aiColor) {
  let moves = orderMoves(game, getAllMovesForColor(game, aiColor));
  if (!moves.length) return null;
  let best = null, bestEval = -Infinity;
  for (const m of moves) {
    const s = saveGameState(game);
    executeMoveQuiet(game, m.fromR, m.fromC, m.toR, m.toC, m.moveData);
    game.turn = opponent(game.turn);
    const v = minimax(game, AI_DEPTH-1, -Infinity, Infinity, false, aiColor);
    restoreGameState(game, s);
    if (v > bestEval) { bestEval = v; best = m; }
  }
  return best;
}

function triggerAIMove(room) {
  const g = room.game;
  const aiColor = room.botColor;
  if (g.gameOver || g.turn !== aiColor) return;

  // AI cloak: 30% chance if shadow is available
  if (g.energy[aiColor] >= 1 && !g.cloaked[aiColor]) {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (g.board[r][c].type === SHADOW && g.board[r][c].color === aiColor && Math.random() < 0.3) {
          g.energy[aiColor] -= 1;
          g.cloaked[aiColor] = {r,c};
          g.cloakTurnsLeft[aiColor] = 2;
          g.log.push(`👻 Computer's Shadow cloaks!`);
          break;
        }
      }
    }
  }

  // AI decree: if 2+ enemy pieces adjacent to king
  if (g.energy[aiColor] >= 3) {
    const king = findKing_(g.board, aiColor);
    if (king) {
      let adj = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const er = king.r + dr, ec = king.c + dc;
          if (inBounds(er, ec) && g.board[er][ec].color === opponent(aiColor)) adj++;
        }
      }
      if (adj >= 2) {
        g.energy[aiColor] -= 3;
        let pushed = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const er = king.r + dr, ec = king.c + dc;
            if (!inBounds(er, ec)) continue;
            if (g.board[er][ec].color === opponent(aiColor)) {
              const pr = er + dr, pc = ec + dc;
              if (inBounds(pr, pc) && isEmpty_(g.board, pr, pc)) {
                g.board[pr][pc] = g.board[er][ec];
                g.board[er][ec] = {type:EMPTY, color:0};
                pushed++;
              } else if (!inBounds(pr, pc)) {
                g.board[er][ec] = {type:EMPTY, color:0};
                pushed++;
              }
            }
          }
        }
        g.log.push(`👑 Computer's Decree! ${pushed} enemies pushed!`);
        endTurn(g);
        broadcastRoom(room);
        // Check if it's still AI's turn (shouldn't be, but safety)
        if (!g.gameOver && g.turn === aiColor) {
          setTimeout(() => triggerAIMove(room), 500);
        }
        return;
      }
    }
  }

  // Find best move via minimax
  const best = findBestMove(g, aiColor);
  if (!best) return;

  const result = executeMove(g, best.fromR, best.fromC, best.toR, best.toC, best.moveData);
  if (result === 'promotion') {
    // AI auto-promotes to Queen
    g.board[best.toR][best.toC] = { type: QUEEN, color: aiColor };
    g.log.push(`⬆️ Computer promotes to Queen!`);
    room.promotionPending = null;
  }

  const status = endTurn(g);
  broadcastRoom(room);

  // If somehow still AI's turn, continue
  if (!g.gameOver && g.turn === aiColor) {
    setTimeout(() => triggerAIMove(room), 500);
  }
}


// ============ ROOMS ============
const rooms = new Map();

function createRoom() {
  const id = crypto.randomBytes(3).toString('hex');
  const room = {
    id,
    game: createGame(),
    players: { [WHITE]: null, [BLACK]: null },
    spectators: [],
    promotionPending: null, // {r, c, color}
    created: Date.now(),
    isBot: false,
    botColor: null
  };
  rooms.set(id, room);
  return room;
}

function getClientState(room, playerColor) {
  const g = room.game;
  // Filter cloaked pieces: hide opponent's cloaked shadow
  const board = g.board.map(row => row.map(cell => ({...cell})));
  // Mark cloaked cells
  const cloakInfo = {};
  for (const col of [WHITE, BLACK]) {
    if (g.cloaked[col] && g.cloakTurnsLeft[col] > 0) {
      if (col === playerColor) {
        // Show own cloaked piece dimmed
        cloakInfo[col] = { ...g.cloaked[col], visible: true };
      } else {
        // Hide opponent's cloaked piece entirely
        const { r, c } = g.cloaked[col];
        board[r][c] = { type: EMPTY, color: 0 };
        cloakInfo[col] = null;
      }
    }
  }

  return {
    board,
    turn: g.turn,
    moveCount: g.moveCount,
    energy: g.energy,
    gameOver: g.gameOver,
    winner: g.winner,
    log: g.log.slice(-30),
    cloaked: cloakInfo,
    enPassant: g.enPassant,
    castleRights: g.castleRights,
    promotionPending: room.promotionPending,
    isBot: room.isBot
  };
}

function broadcastRoom(room) {
  for (const col of [WHITE, BLACK]) {
    const ws = room.players[col];
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: 'state',
        state: getClientState(room, col),
        yourColor: col
      }));
    }
  }
  for (const ws of room.spectators) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: 'state',
        state: getClientState(room, null),
        yourColor: null
      }));
    }
  }
}

// Clean up old rooms every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (now - room.created > 3 * 60 * 60 * 1000) { // 3 hours
      rooms.delete(id);
    }
  }
}, 10 * 60 * 1000);

// ============ WEBSOCKET ============
wss.on('connection', (ws) => {
  let myRoom = null;
  let myColor = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'create': {
        const room = createRoom();
        myRoom = room;
        myColor = WHITE;
        room.players[WHITE] = ws;
        ws.send(JSON.stringify({ type: 'created', roomId: room.id, yourColor: WHITE }));
        broadcastRoom(room);
        break;
      }

      case 'create_vs_bot': {
        const room = createRoom();
        myRoom = room;
        myColor = WHITE;
        room.players[WHITE] = ws;
        room.isBot = true;
        room.botColor = BLACK;
        // No BLACK player ws — the bot is server-side
        ws.send(JSON.stringify({ type: 'joined', roomId: room.id, yourColor: WHITE }));
        broadcastRoom(room);
        break;
      }

      case 'join': {
        const room = rooms.get(msg.roomId);
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
          return;
        }
        myRoom = room;
        if (!room.players[BLACK]) {
          myColor = BLACK;
          room.players[BLACK] = ws;
          ws.send(JSON.stringify({ type: 'joined', roomId: room.id, yourColor: BLACK }));
          // Notify white that opponent joined
          if (room.players[WHITE] && room.players[WHITE].readyState === 1) {
            room.players[WHITE].send(JSON.stringify({ type: 'opponent_joined' }));
          }
        } else if (!room.players[WHITE]) {
          myColor = WHITE;
          room.players[WHITE] = ws;
          ws.send(JSON.stringify({ type: 'joined', roomId: room.id, yourColor: WHITE }));
          if (room.players[BLACK] && room.players[BLACK].readyState === 1) {
            room.players[BLACK].send(JSON.stringify({ type: 'opponent_joined' }));
          }
        } else {
          // Spectator
          myColor = null;
          room.spectators.push(ws);
          ws.send(JSON.stringify({ type: 'spectating', roomId: room.id }));
        }
        broadcastRoom(room);
        break;
      }

      case 'move': {
        if (!myRoom || !myColor) return;
        const g = myRoom.game;
        if (g.gameOver || g.turn !== myColor) return;
        if (myRoom.promotionPending) return;

        const { fromR, fromC, toR, toC } = msg;
        // Validate move
        const legal = getLegalMoves_(g.board, fromR, fromC, g.enPassant, g.castleRights);
        const move = legal.find(m => m.r === toR && m.c === toC);
        if (!move) return;
        if (g.board[fromR][fromC].color !== myColor) return;

        const result = executeMove(g, fromR, fromC, toR, toC, move);
        if (result === 'promotion') {
          myRoom.promotionPending = { r: toR, c: toC, color: myColor };
          broadcastRoom(myRoom);
          return;
        }

        const status = endTurn(g);
        broadcastRoom(myRoom);

        // If it's now the bot's turn, trigger AI
        if (myRoom.isBot && !g.gameOver && g.turn === myRoom.botColor) {
          setTimeout(() => triggerAIMove(myRoom), 600);
        }
        break;
      }

      case 'promote': {
        if (!myRoom || !myColor) return;
        const pp = myRoom.promotionPending;
        if (!pp || pp.color !== myColor) return;
        const validTypes = [QUEEN, ROOK, BISHOP, KNIGHT, DRAGON];
        if (!validTypes.includes(msg.pieceType)) return;

        myRoom.game.board[pp.r][pp.c] = { type: msg.pieceType, color: pp.color };
        myRoom.game.log.push(`⬆️ Pawn promotes to ${PIECE_NAMES[msg.pieceType]}!`);
        myRoom.promotionPending = null;

        const status = endTurn(myRoom.game);
        broadcastRoom(myRoom);

        // If it's now the bot's turn, trigger AI
        if (myRoom.isBot && !myRoom.game.gameOver && myRoom.game.turn === myRoom.botColor) {
          setTimeout(() => triggerAIMove(myRoom), 600);
        }
        break;
      }

      case 'decree': {
        if (!myRoom || !myColor) return;
        const g = myRoom.game;
        if (g.gameOver || g.turn !== myColor) return;
        if (g.energy[myColor] < 3) return;

        const king = findKing_(g.board, myColor);
        if (!king) return;

        g.energy[myColor] -= 3;
        let pushed = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const er = king.r + dr, ec = king.c + dc;
            if (!inBounds(er, ec)) continue;
            if (g.board[er][ec].color === opponent(myColor)) {
              const pushR = er + dr, pushC = ec + dc;
              if (inBounds(pushR, pushC) && isEmpty_(g.board, pushR, pushC)) {
                g.board[pushR][pushC] = g.board[er][ec];
                g.board[er][ec] = {type:EMPTY, color:0};
                pushed++;
              } else if (!inBounds(pushR, pushC)) {
                g.board[er][ec] = {type:EMPTY, color:0};
                pushed++;
              }
            }
          }
        }
        g.log.push(`👑 King's Decree! ${pushed} enemies pushed away!`);
        endTurn(g);
        broadcastRoom(myRoom);

        // If it's now the bot's turn, trigger AI
        if (myRoom.isBot && !g.gameOver && g.turn === myRoom.botColor) {
          setTimeout(() => triggerAIMove(myRoom), 600);
        }
        break;
      }

      case 'cloak': {
        if (!myRoom || !myColor) return;
        const g = myRoom.game;
        if (g.gameOver || g.turn !== myColor) return;
        if (g.energy[myColor] < 1) return;
        if (g.cloaked[myColor]) return;

        const { r, c } = msg;
        if (!inBounds(r, c)) return;
        if (g.board[r][c].type !== SHADOW || g.board[r][c].color !== myColor) return;

        g.energy[myColor] -= 1;
        g.cloaked[myColor] = { r, c };
        g.cloakTurnsLeft[myColor] = 2;
        g.log.push(`👻 ${myColor===WHITE?'White':'Black'} Shadow cloaks!`);
        broadcastRoom(myRoom);
        break;
      }

      case 'get_legal_moves': {
        if (!myRoom || !myColor) return;
        const g = myRoom.game;
        if (g.turn !== myColor || g.gameOver) return;
        if (g.board[msg.r][msg.c].color !== myColor) return;
        const moves = getLegalMoves_(g.board, msg.r, msg.c, g.enPassant, g.castleRights);
        ws.send(JSON.stringify({ type: 'legal_moves', r: msg.r, c: msg.c, moves }));
        break;
      }

      case 'new_game': {
        if (!myRoom) return;
        // Only allow if game is over
        if (myRoom.game.gameOver) {
          myRoom.game = createGame();
          myRoom.promotionPending = null;

          if (myRoom.isBot) {
            // Swap colors: player gets opposite color
            const humanColor = myColor === WHITE ? BLACK : WHITE;
            myColor = humanColor;
            myRoom.botColor = opponent(humanColor);

            // Reassign player socket to new color
            myRoom.players = { [WHITE]: null, [BLACK]: null };
            myRoom.players[myColor] = ws;

            ws.send(JSON.stringify({ type: 'color_swap', yourColor: myColor }));
            myRoom.game.log.push('🎮 New game! Colors swapped.');
            broadcastRoom(myRoom);

            // If bot is white (goes first), trigger AI
            if (myRoom.botColor === WHITE) {
              setTimeout(() => triggerAIMove(myRoom), 600);
            }
          } else {
            // Swap colors for PvP
            const tmpWs = myRoom.players[WHITE];
            myRoom.players[WHITE] = myRoom.players[BLACK];
            myRoom.players[BLACK] = tmpWs;
            // Notify both of new colors
            for (const col of [WHITE, BLACK]) {
              const ws2 = myRoom.players[col];
              if (ws2 && ws2.readyState === 1) {
                ws2.send(JSON.stringify({ type: 'color_swap', yourColor: col }));
              }
            }
            // Update our own reference
            if (ws === myRoom.players[WHITE]) myColor = WHITE;
            else if (ws === myRoom.players[BLACK]) myColor = BLACK;
            myRoom.game.log.push('🎮 New game! Colors swapped.');
            broadcastRoom(myRoom);
          }
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    if (myRoom) {
      if (myColor && myRoom.players[myColor] === ws) {
        myRoom.players[myColor] = null;
        // Notify opponent
        const oppColor = opponent(myColor);
        const opp = myRoom.players[oppColor];
        if (opp && opp.readyState === 1) {
          opp.send(JSON.stringify({ type: 'opponent_left' }));
        }
      } else {
        myRoom.spectators = myRoom.spectators.filter(s => s !== ws);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Chess 2 Online running on http://localhost:${PORT}`);
});
