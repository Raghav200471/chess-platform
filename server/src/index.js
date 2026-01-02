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
const isValidMove_c = wasmModule.cwrap('isValidMove', 'number', ['number','number','number','number','number','number']);
const calloc_c = wasmModule.cwrap('wasm_malloc', 'number', ['number']);
const free_c = wasmModule.cwrap('wasm_free', null, ['number']);

function writeBoardToPtr(board) {
  const flat = new Uint8Array(64);
  for (let r=0; r<8; r++) {
    for (let c=0; c<8; c++) {
      const ch = board[r][c] ? board[r][c].charCodeAt(0) : 32; // ' '
      flat[r*8+c] = ch;
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

mongoose.connect('mongodb://127.0.0.1:27017/chess');

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

  socket.on(EVENTS.GAME_CREATE, () => {
    if (!user) return socket.emit(EVENTS.GAME_ERROR, { message: 'Authentication required.' });
    const gameId = crypto.randomUUID().slice(0, 8);
    games.set(gameId, {
      board: JSON.parse(JSON.stringify(initialBoard)),
      turn: 'white',
      players: { 
        white: { id: socket.id, user },
        black: null 
      },
      check: null,
    });
    socket.join(ROOMS.game(gameId));
    socket.emit(EVENTS.GAME_CREATED, { gameId });
  });

  socket.on(EVENTS.GAME_FIND, () => {
    if (!user) return socket.emit(EVENTS.GAME_ERROR, { message: 'Authentication required.' });
    
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
      });

      player1Socket.join(room);
      player2Socket.join(room);

      player1Socket.emit(EVENTS.GAME_JOINED, { gameId, color: players.white.id === player1Socket.id ? 'white' : 'black', board: games.get(gameId).board });
      player2Socket.emit(EVENTS.GAME_JOINED, { gameId, color: players.white.id === player2Socket.id ? 'white' : 'black', board: games.get(gameId).board });

      io.to(room).emit(EVENTS.GAME_STATE, {
        board: games.get(gameId).board, turn: 'white', players: 2, check: null
      });
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
    socket.emit(EVENTS.GAME_JOINED, { gameId, color: 'black', board: game.board });
    io.to(room).emit(EVENTS.GAME_STATE, {
      board: game.board, turn: game.turn, players: 2, check: game.check
    });
  });

  socket.on(EVENTS.GAME_MOVE, ({ gameId, from, to }) => {
    const game = games.get(gameId);
    if (!game) return;
    
    const { board, players, turn } = game;
    const playerSocketId = (turn === 'white') ? players.white.id : players.black.id;
    if (socket.id !== playerSocketId) return socket.emit(EVENTS.GAME_ERROR, { message: "It's not your turn." });
    
    if (isValidMoveWasm(board, from, to, turn)) {
      const piece = board[from[0]][from[1]];
      board[to[0]][to[1]] = piece;
      board[from[0]][from[1]] = '';
      
      game.turn = (turn === 'white') ? 'black' : 'white';
      
      const inCheck = isKingInCheck(board, game.turn, isValidMoveWasm);
      game.check = inCheck ? game.turn : null;

      const room = ROOMS.game(gameId);
      io.to(room).emit(EVENTS.GAME_STATE, {
        board: game.board, turn: game.turn, check: game.check
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

    games.forEach((game, gameId) => {
        const player = Object.values(game.players).find(p => p && p.id === socket.id);
        if(player) {
            const opponentColor = player.user.username === game.players.white.user.username ? 'black' : 'white';
            const status = { winner: opponentColor, reason: 'Opponent disconnected.' };
            io.to(ROOMS.game(gameId)).emit(EVENTS.GAME_OVER, status);
            saveGame(gameId, game, status);
            games.delete(gameId);
        }
    });
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

const PORT = process.env.PORT ?? 4000;
server.listen(PORT, () => console.log(`Server listening on :${PORT}`));

