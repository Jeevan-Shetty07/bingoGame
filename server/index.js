// server/index.js - the main brain of the server

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
  kickPlayer,
  handleDisconnect,
} = require("./rooms");

const { isBingo } = require("./bingoLogic");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const turnTimeouts = {}; // keepin track of idle players 
const socketRoomMap = {}; // socketId -> roomId for quick lookup

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
    turnExpiresAt: room.turnExpiresAt,
  });

  // start a skip timer for lazy players IF not already running
  if (!room.turnLocked && !room.winner && room.gameStarted && !turnTimeouts[roomId]) {
    const timeToWait = (room.turnExpiresAt - Date.now()) + 1000; // 1s buffer
    
    turnTimeouts[roomId] = setTimeout(() => {
      delete turnTimeouts[roomId];
      console.log(`skipping lazy player in room ${roomId}`);
      
      const r = rooms[roomId];
      if (!r) return;

      if (r.turnLocked) {
        unlockAndNext(roomId);
      } else {
        nextTurn(r);
        emitTurn(roomId);
      }
    }, Math.max(0, timeToWait));
  }
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
  console.log(`new node connected: ${socket.id}`);
  
  // let the client know what time it is on the server so they can sync up
  socket.emit("serverTime", Date.now());

  socket.on("createRoom", ({ name, boardSize }) => {
    const roomId = createRoom(socket.id, name, boardSize);
    socket.join(roomId);
    socketRoomMap[socket.id] = roomId;
    socket.emit("roomJoined", rooms[roomId]);
  });

  socket.on("joinRoom", ({ roomId, name }) => {
    const room = joinRoom(roomId, socket.id, name);
    if (!room) return socket.emit("errorMsg", "Room invalid");

    socket.join(roomId);
    socketRoomMap[socket.id] = roomId;
    
    // Send full room update + current turn state
    io.to(roomId).emit("roomUpdated", room);
    emitTurn(roomId);
    emitCall(roomId);
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

  // handles when some1 calls a numbr
  socket.on("callNumber", ({ roomId, number }) => {
    const room = rooms[roomId];
    if (!room || room.turnLocked) return;

    const current = room.players[room.currentTurnIndex];
    if (!current) return;

    if (current.id !== socket.id) return;

    // clear the idle timer cuz they actualy did somethin
    clearTimeout(turnTimeouts[roomId]);

    const ok = callNumber(room, number);
    if (!ok) return;

    // if u call it u basicly marked it already
    markDone(room, socket.id);

    emitCall(roomId);
    emitTurn(roomId);

    // dont want the game stuck if some1 goes afk lol - unlock after 11s
    setTimeout(() => {
      if (room.turnLocked) unlockAndNext(roomId);
    }, 11_000);
  });

  socket.on("kickPlayer", ({ roomId, targetId }) => {
    const room = rooms[roomId];
    if (!room || room.hostId !== socket.id || targetId === socket.id) return;

    const ok = kickPlayer(roomId, targetId);
    if (ok) {
      delete socketRoomMap[targetId];
      io.to(targetId).emit("kicked");
      io.to(roomId).emit("roomUpdated", room);
      console.log(`Player ${targetId} was kicked from room ${roomId}`);
    }
  });

  // when players finish markin their board
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

  // checking if someone actually won or just faking it
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

  // restart the game without refreshin the whole page
  socket.on("rematch", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;

    // host is the boss here
    if (room.hostId !== socket.id) {
      socket.emit("errorMsg", "Only host can start rematch!");
      return;
    }

    // clear stuff and gnerate new boards for evryone
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

  // basic chat stuff so ppl can talk
  socket.on("sendMessage", ({ roomId, message, name }) => {
    if (!roomId || !message) return;
    io.to(roomId).emit("receiveMessage", {
      name,
      message,
      time: new Date().toLocaleTimeString('en-IN', { 
        hour: '2-digit', 
        minute: '2-digit',
        timeZone: 'Asia/Kolkata'
      })
    });
  });

  // emoji reactions for fun
  socket.on("sendEmoji", ({ roomId, emoji, name }) => {
    if (!roomId || !emoji) return;
    io.to(roomId).emit("receiveEmoji", { emoji, name, socketId: socket.id });
  });

  socket.on("disconnect", () => {
    console.log(`node disconnected: ${socket.id}`);
    const roomId = socketRoomMap[socket.id];
    delete socketRoomMap[socket.id];

    if (roomId) {
      const room = rooms[roomId];
      if (room) {
        handleDisconnect(socket.id);
        
        if (room.gameStarted && !room.winner) {
          if (room.players.length > 0) {
            room.currentTurnIndex %= room.players.length;
            if (room.turnLocked && allDone(room)) {
              unlockAndNext(roomId);
            }
          }
          io.to(roomId).emit("roomUpdated", room);
          emitTurn(roomId);
        } else {
          io.to(roomId).emit("roomUpdated", room);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("Server running on port:", PORT);
});
