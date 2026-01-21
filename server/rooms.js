// server/rooms.js

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function generateBoard(size) {
  const nums = shuffle(Array.from({ length: size * size }, (_, i) => i + 1));
  const board = [];
  for (let i = 0; i < size; i++) {
    board.push(nums.slice(i * size, (i + 1) * size));
  }
  return board;
}

const rooms = {};

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function createRoom(socketId, name, boardSize) {
  const roomId = generateRoomId();

  rooms[roomId] = {
    id: roomId,
    boardSize,
    hostId: socketId,
    players: [{ id: socketId, name, board: null }],
    gameStarted: false,

    currentTurnIndex: 0,

    calledNumbers: [],
    currentCall: null,

    turnLocked: false,

    // socketId -> true/false
    responded: {},

    winner: null,
  };

  return roomId;
}

function joinRoom(roomId, socketId, name) {
  const room = rooms[roomId];
  if (!room) return null;
  if (room.players.length >= 10) return null;

  room.players.push({ id: socketId, name, board: null });

  // if game already started, ensure responded map has this player too
  if (room.gameStarted && room.turnLocked) {
    room.responded[socketId] = false;
  }

  return room;
}

function startGame(room) {
  room.players.forEach((p) => {
    p.board = generateBoard(room.boardSize);
  });

  room.calledNumbers = [];
  room.currentCall = null;
  room.currentTurnIndex = 0;
  room.turnLocked = false;

  // reset responded map properly for all players
  room.responded = {};
  room.players.forEach((p) => {
    room.responded[p.id] = true; // nobody is waiting before first call
  });

  room.winner = null;
  room.gameStarted = true;
}

function nextTurn(room) {
  room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
}

function callNumber(room, number) {
  const max = room.boardSize * room.boardSize;

  if (number < 1 || number > max) return { ok: false, msg: "Invalid number" };
  if (room.calledNumbers.includes(number))
    return { ok: false, msg: "Already called" };

  room.calledNumbers.push(number);

  room.currentCall = {
    number,
    expiresAt: Date.now() + 10_000,
  };

  room.turnLocked = true;

  // reset response tracking for THIS call
  room.responded = {};
  room.players.forEach((p) => {
    room.responded[p.id] = false;
  });

  return { ok: true };
}

function markDone(room, socketId) {
  // ✅ Always mark as done, even if undefined
  if (!room.responded) room.responded = {};
  room.responded[socketId] = true;
}

function remainingCount(room) {
  if (!room.responded) return 0;
  return Object.values(room.responded).filter((v) => v === false).length;
}

function allDone(room) {
  return remainingCount(room) === 0;
}

module.exports = {
  rooms,
  createRoom,
  joinRoom,
  startGame,
  nextTurn,
  callNumber,
  markDone,
  remainingCount,
  allDone,
};
