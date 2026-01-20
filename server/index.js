// server/index.js

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const {
  createRoom,
  joinRoom,
  rooms,
  startGame,
  nextTurn,
  callNumber,
  markDone,
  remainingCount,
  allDone,
} = require("./rooms");

const { isBingo } = require("./bingoLogic");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("client"));

function getPendingNames(room) {
  if (!room.responded) return [];

  const pendingIds = Object.keys(room.responded).filter(
    (id) => room.responded[id] === false
  );

  return room.players
    .filter((p) => pendingIds.includes(p.id))
    .map((p) => p.name);
}

function emitTurn(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  io.to(roomId).emit("turnUpdate", {
    currentTurnIndex: room.currentTurnIndex,
    players: room.players.map((p) => ({ id: p.id, name: p.name })),
    turnLocked: room.turnLocked,
    remaining: remainingCount(room),
    pendingNames: getPendingNames(room),
  });
}

function emitCall(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  io.to(roomId).emit("calledNumbersUpdate", {
    calledNumbers: room.calledNumbers,
    currentCall: room.currentCall,
    remaining: remainingCount(room),
    pendingNames: getPendingNames(room),
  });
}

function unlockAndNext(roomId) {
  const room = rooms[roomId];
  if (!room || !room.turnLocked) return;

  room.turnLocked = false;
  nextTurn(room);

  emitTurn(roomId);
}

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.on("createRoom", ({ name, boardSize }) => {
    const roomId = createRoom(socket.id, name, boardSize);
    socket.join(roomId);
    socket.emit("roomJoined", rooms[roomId]);
  });

  socket.on("joinRoom", ({ roomId, name }) => {
    const room = joinRoom(roomId, socket.id, name);
    if (!room) return socket.emit("errorMsg", "Room invalid");

    socket.join(roomId);
    io.to(roomId).emit("roomUpdated", room);
  });

  socket.on("startGame", (roomId) => {
    const room = rooms[roomId];
    if (!room || room.hostId !== socket.id) return;

    startGame(room);

    room.players.forEach((p) => {
      io.to(p.id).emit("gameStarted", {
        board: p.board,
        boardSize: room.boardSize,
      });
    });

    emitTurn(roomId);
    emitCall(roomId);
  });

  /************** CALL NUMBER **************/
  socket.on("callNumber", ({ roomId, number }) => {
    const room = rooms[roomId];
    if (!room || room.turnLocked) return;

    const current = room.players[room.currentTurnIndex];
    if (!current) return;

    if (current.id !== socket.id) return;

    const ok = callNumber(room, number);
    if (!ok) return;

    // caller instantly done
    markDone(room, socket.id);

    emitCall(roomId);
    emitTurn(roomId);

    // safety unlock after 10s
    setTimeout(() => {
      if (room.turnLocked) unlockAndNext(roomId);
    }, 10_000);
  });

  /************** PLAYER DONE **************/
  socket.on("markDone", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || !room.turnLocked) return;

    markDone(room, socket.id);

    emitTurn(roomId);
    emitCall(roomId);

    if (allDone(room)) {
      unlockAndNext(roomId);
    }
  });

  /************** CLAIM BINGO **************/
  socket.on("claimBingo", ({ roomId, marked, name }) => {
    const room = rooms[roomId];
    if (!room || room.winner) return;

    if (!isBingo(marked)) {
      socket.emit("errorMsg", "Invalid Bingo");
      return;
    }

    room.winner = { id: socket.id, name };

    io.to(roomId).emit("winnerDeclared", {
      winnerName: name,
    });
  });

  /************** REMATCH (NO RELOAD) **************/
  socket.on("rematch", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;

    // only host can restart (optional)
    if (room.hostId !== socket.id) {
      socket.emit("errorMsg", "Only host can start rematch!");
      return;
    }

    // reset and generate new boards
    startGame(room);

    room.players.forEach((p) => {
      io.to(p.id).emit("gameStarted", {
        board: p.board,
        boardSize: room.boardSize,
      });
    });

    emitTurn(roomId);
    emitCall(roomId);

    console.log("Rematch started in room:", roomId);
  });
});

server.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
