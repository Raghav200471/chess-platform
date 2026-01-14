import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { Server } from 'socket.io';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import fs from 'fs/promises';
import path from 'path';

import authRoutes from './routes/auth.js';
import User from './models/User.js';
import { EVENTS, ROOMS } from '../../shared/src/events.js';
import Game from './models/Game.js';
import gamesRoutes from './routes/games.js';
import { isKingInCheck, getGameStatus } from './chessUtils.js';

// --- MODIFIED: Load the .mjs module and await its initialization ---
import createWasmModule from './moveValidator.mjs';
const wasmModule = await createWasmModule();

// --- after the module is created ---
const isValidMove_c = wasmModule.cwrap('isValidMove', 'number', ['number', 'number', 'number', 'number', 'number', 'number']);
const calloc_c = wasmModule.cwrap('wasm_malloc', 'number', ['number']);
const free_c = wasmModule.cwrap('wasm_free', null, ['number']);

function writeBoardToPtr(board) {
  const flat = new Uint8Array(64);
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const ch = board[r][c] ? board[r][c].charCodeAt(0) : 32; // ' '
      flat[r * 8 + c] = ch;
    }
  }
  const ptr = calloc_c(flat.length);
  new Uint8Array(wasmModule.HEAPU8.buffer, ptr, flat.length).set(flat);
  return ptr;
}

const isValidMoveWasm = (board, from, to, turn) => {
  const [fr, fc] = from, [tr, tc] = to;
  const boardPtr = writeBoardToPtr(board);
  let ok = !!isValidMove_c(boardPtr, fr, fc, tr, tc, turn === 'white');

  // simulate board and ensure king not in check
  const temp = board.map(r => [...r]);
  temp[tr][tc] = board[fr][fc];
  temp[fr][fc] = '';
  const leavesKingInCheck = isKingInCheck(temp, turn, (b, f, t, attackerColor) => {
    const p = writeBoardToPtr(b);
    const res = !!isValidMove_c(p, f[0], f[1], t[0], t[1], attackerColor === 'white');
    free_c(p);
    return res;
  });

  free_c(boardPtr);
  return ok && !leavesKingInCheck;
};


const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CLIENT_ORIGIN, credentials: true }
});

const games = new Map();
const matchmakingQueue = [];

const initialBoard = [
  ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'], ['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p'],
  ['', '', '', '', '', '', '', ''], ['', '', '', '', '', '', '', ''],
  ['', '', '', '', '', '', '', ''], ['', '', '', '', '', '', '', ''],
  ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'], ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R']
];

app.use(cors({ origin: process.env.CLIENT_ORIGIN, credentials: true }));
app.use(express.json());
app.use('/auth', authRoutes);
app.use('/api/games', gamesRoutes);
app.get('/health', (_, res) => res.json({ ok: true }));

mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/chess');

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (token) {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.data.user = await User.findById(payload.id).select('-passwordHash');
    }
    next();
  } catch (err) {
    next(new Error('unauthorized'));
  }
});

io.on('connection', (socket) => {
  const user = socket.data.user;

  socket.on(EVENTS.GAME_CREATE, (payload) => {
    if (!user) return socket.emit(EVENTS.GAME_ERROR, { message: 'Authentication required.' });
    const gameId = crypto.randomUUID().slice(0, 8);

    // Parse time control from payload (minutes)
    // Parse time control from payload (minutes) - Force integer parsing
    let timeMinutes = 10;
    if (payload && payload.timeControl) {
      timeMinutes = parseInt(payload.timeControl, 10);
      if (isNaN(timeMinutes)) timeMinutes = 10;
    }
    const timeMs = timeMinutes * 60 * 1000;

    games.set(gameId, {
      board: JSON.parse(JSON.stringify(initialBoard)),
      turn: 'white',
      players: {
        white: { id: socket.id, user },
        black: null
      },
      check: null,
      timeControl: timeMs,
      whiteTime: timeMs,
      blackTime: timeMs,
      lastMoveTime: null
    });

    socket.join(ROOMS.game(gameId));
    socket.emit(EVENTS.GAME_CREATED, { gameId, whiteTime: timeMs, blackTime: timeMs });
  });

  // --- Active Timeout Logic ---
  const gameTimeouts = new Map();

  function clearGameTimeout(gameId) {
    if (gameTimeouts.has(gameId)) {
      clearTimeout(gameTimeouts.get(gameId));
      gameTimeouts.delete(gameId);
    }
  }

  function setGameTimeout(gameId, duration, color) {
    clearGameTimeout(gameId);
    if (duration <= 0) return handleTimeout(gameId, color);

    // Add buffer (e.g. 500ms) to allow latency before strict server kill
    const timeoutId = setTimeout(() => {
      handleTimeout(gameId, color);
    }, duration + 1000);
    gameTimeouts.set(gameId, timeoutId);
  }

  function handleTimeout(gameId, loserColor) {
    const game = games.get(gameId);
    if (!game) return;

    const winner = loserColor === 'white' ? 'black' : 'white';
    const status = { winner, reason: 'Timeout' };
    io.to(ROOMS.game(gameId)).emit(EVENTS.GAME_OVER, status);
    saveGame(gameId, game, status);
    games.delete(gameId);
    gameTimeouts.delete(gameId); // Cleanup map
  }
  // ----------------------------

  socket.on(EVENTS.GAME_FIND, () => {
    if (!user) return socket.emit(EVENTS.GAME_ERROR, { message: 'Authentication required.' });

    socket.on(EVENTS.GAME_FIND_CANCEL, () => {
      const index = matchmakingQueue.findIndex(s => s.id === socket.id);
      if (index !== -1) {
        matchmakingQueue.splice(index, 1);
      }
    });

    matchmakingQueue.push(socket);
    socket.emit(EVENTS.GAME_FINDING);

    if (matchmakingQueue.length >= 2) {
      const player1Socket = matchmakingQueue.shift();
      const player2Socket = matchmakingQueue.shift();

      const gameId = crypto.randomUUID().slice(0, 8);
      const room = ROOMS.game(gameId);

      const players = Math.random() < 0.5
        ? { white: { id: player1Socket.id, user: player1Socket.data.user }, black: { id: player2Socket.id, user: player2Socket.data.user } }
        : { white: { id: player2Socket.id, user: player2Socket.data.user }, black: { id: player1Socket.id, user: player1Socket.data.user } };

      games.set(gameId, {
        board: JSON.parse(JSON.stringify(initialBoard)),
        turn: 'white',
        players,
        check: null,
        // Default to 10 minutes if not specified
        timeControl: 10 * 60 * 1000,
        whiteTime: 10 * 60 * 1000,
        blackTime: 10 * 60 * 1000,
        lastMoveTime: null, // Timer starts on first move interaction? Or immediately? usually immediately after 2nd player joins or first move. 
        // For simplicity: start when game becomes full (2nd player joins)
      });

      player1Socket.join(room);
      player2Socket.join(room);

      // Send Join with time data (for consistency with manual join)
      const joinedPayload1 = { gameId, color: players.white.id === player1Socket.id ? 'white' : 'black', board: games.get(gameId).board, whiteTime: games.get(gameId).whiteTime, blackTime: games.get(gameId).blackTime };
      const joinedPayload2 = { gameId, color: players.white.id === player2Socket.id ? 'white' : 'black', board: games.get(gameId).board, whiteTime: games.get(gameId).whiteTime, blackTime: games.get(gameId).blackTime };

      player1Socket.emit(EVENTS.GAME_JOINED, joinedPayload1);
      player2Socket.emit(EVENTS.GAME_JOINED, joinedPayload2);

      const g = games.get(gameId);
      io.to(room).emit(EVENTS.GAME_STATE, {
        board: g.board, turn: 'white', players: 2, check: null,
        whiteTime: g.whiteTime, blackTime: g.blackTime, lastMoveTime: g.lastMoveTime
      });

      // Start active timer logic
      g.lastMoveTime = Date.now();
      setGameTimeout(gameId, g.whiteTime, 'white');
    }
  });

  socket.on(EVENTS.GAME_JOIN, ({ gameId }) => {
    if (!user) return socket.emit(EVENTS.GAME_ERROR, { message: 'Authentication required.' });
    const game = games.get(gameId);
    if (!game) return socket.emit(EVENTS.GAME_ERROR, { message: 'Game not found.' });
    if (game.players.black) return socket.emit(EVENTS.GAME_ERROR, { message: 'Game is full.' });
    if (game.players.white.id === socket.id) return socket.emit(EVENTS.GAME_ERROR, { message: 'You have already joined.' });

    const room = ROOMS.game(gameId);
    game.players.black = { id: socket.id, user };
    socket.join(room);

    // Send join confirmation with TIME data
    socket.emit(EVENTS.GAME_JOINED, {
      gameId,
      color: 'black',
      board: game.board,
      whiteTime: game.whiteTime,
      blackTime: game.blackTime
    });

    io.to(room).emit(EVENTS.GAME_STATE, {
      board: game.board, turn: game.turn, players: 2, check: game.check,
      whiteTime: game.whiteTime, blackTime: game.blackTime, lastMoveTime: game.lastMoveTime
    });

    // Start active timer for White
    game.lastMoveTime = Date.now();
    setGameTimeout(gameId, game.whiteTime, 'white');
  });

  socket.on(EVENTS.GAME_MOVE, ({ gameId, from, to }) => {
    const game = games.get(gameId);
    if (!game) return;

    const { board, players, turn } = game;
    const playerSocketId = (turn === 'white') ? players.white.id : players.black.id;
    if (socket.id !== playerSocketId) return socket.emit(EVENTS.GAME_ERROR, { message: "It's not your turn." });

    if (isValidMoveWasm(board, from, to, turn)) {
      // --- TIMER LOGIC ---
      if (game.lastMoveTime) {
        const now = Date.now();
        const elapsed = now - game.lastMoveTime;
        if (turn === 'white') {
          game.whiteTime -= elapsed;
        } else {
          game.blackTime -= elapsed;
        }
      }

      // Check for Timeout
      if (game.whiteTime <= 0 || game.blackTime <= 0) {
        clearGameTimeout(gameId); // Clear active if we caught it here
        const winner = game.whiteTime <= 0 ? 'black' : 'white';
        const status = { winner, reason: 'Timeout' };
        io.to(ROOMS.game(gameId)).emit(EVENTS.GAME_OVER, status);
        saveGame(gameId, game, status);
        games.delete(gameId);
        return;
      }
      game.lastMoveTime = Date.now();

      // Switch Active Timeout to next player
      // Turn has already been switched to 'game.turn' (the next player)
      const nextColor = game.turn === 'white' ? 'black' : 'white'; // Current 'turn' var is still old turn
      const nextTime = nextColor === 'white' ? game.whiteTime : game.blackTime;
      setGameTimeout(gameId, nextTime, nextColor);
      // -------------------

      const piece = board[from[0]][from[1]];
      board[to[0]][to[1]] = piece;
      board[from[0]][from[1]] = '';

      game.turn = (turn === 'white') ? 'black' : 'white';

      const inCheck = isKingInCheck(board, game.turn, isValidMoveWasm);
      game.check = inCheck ? game.turn : null;

      const room = ROOMS.game(gameId);
      io.to(room).emit(EVENTS.GAME_STATE, {
        board: game.board, turn: game.turn, check: game.check,
        whiteTime: game.whiteTime, blackTime: game.blackTime, lastMoveTime: game.lastMoveTime
      });

      const status = getGameStatus(board, game.turn, isValidMoveWasm);
      if (status) {
        io.to(room).emit(EVENTS.GAME_OVER, status);
        saveGame(gameId, game, status);
        games.delete(gameId);
      }
    } else {
      socket.emit(EVENTS.GAME_ERROR, { message: "Invalid move." });
    }
  });

  socket.on('disconnect', () => {
    const queueIndex = matchmakingQueue.findIndex(s => s.id === socket.id);
    if (queueIndex !== -1) {
      matchmakingQueue.splice(queueIndex, 1);
    }

    // If user was in a game, handle disconnect forfeit
    for (const [gameId, game] of games.entries()) {
      const pWhite = game.players.white;
      const pBlack = game.players.black;
      if ((pWhite && pWhite.id === socket.id) || (pBlack && pBlack.id === socket.id)) {
        clearGameTimeout(gameId); // STOP TIMER
        const winner = (pWhite && pWhite.id === socket.id) ? 'black' : 'white';
        const status = { winner, reason: 'Opponent disconnected.' };
        io.to(ROOMS.game(gameId)).emit(EVENTS.GAME_OVER, status);
        saveGame(gameId, game, status);
        games.delete(gameId);
        break;
      }
    }
  });
});

async function saveGame(gameId, game, status) {
  try {
    if (!game.players.white?.user || !game.players.black?.user) {
      console.log(`Game ${gameId} not saved, missing player data.`);
      return;
    }
    const playersForDb = [
      { userId: game.players.white.user._id, username: game.players.white.user.username, color: 'white' },
      { userId: game.players.black.user._id, username: game.players.black.user.username, color: 'black' }
    ];

    const newGame = new Game({
      gameId,
      players: playersForDb,
      winner: status.winner,
      reason: status.reason,
    });
    await newGame.save();
    console.log(`Game ${gameId} saved to database.`);
  } catch (error) {
    console.error(`Error saving game ${gameId}:`, error);
  }
}

const PORT = process.env.PORT || 4000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server listening on :${PORT}`));
