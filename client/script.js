// client/script.js
const socket = io();

/******** STATE ********/
let currentRoomId = null;
let players = [];
let currentTurnIndex = 0;
let turnLocked = false;

let myBoard = [];
let marked = [];
let calledNumbers = [];
let currentCall = null;

let timerInt = null;
let gameOver = false;

let maskedNumbers = new Set();
let doneSentForThisCall = false;

let remainingPlayers = 0;
let pendingNames = [];

/******** SCREEN ********/
function show(id) {
  document
    .querySelectorAll(".screen")
    .forEach((s) => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

function goHome() {
  gameOver = false;
  show("home");
}

function goToCreate() {
  show("create");
}
function goToJoin() {
  show("join");
}
function copyRoomCode() {
  const code = roomCode?.innerText?.trim();
  if (!code) return alert("Room code not available yet!");

  navigator.clipboard.writeText(code)
    .then(() => {
      alert("Room code copied! 📋✅");
    })
    .catch(() => {
      // fallback if clipboard not allowed
      const temp = document.createElement("input");
      temp.value = code;
      document.body.appendChild(temp);
      temp.select();
      document.execCommand("copy");
      document.body.removeChild(temp);
      alert("Room code copied! 📋✅");
    });
}

/******** ROOM ********/
function createRoom() {
  const name = createName.value.trim();
  const size = Number(boardSize.value);
  if (!name) return alert("Enter name");
  socket.emit("createRoom", { name, boardSize: size });
}

function joinRoom() {
  const name = joinName.value.trim();
  const roomId = joinRoomId.value.trim();
  if (!name || !roomId) return alert("Fill all fields");
  socket.emit("joinRoom", { name, roomId });
}

function startGame() {
  socket.emit("startGame", currentRoomId);
}

/******** SOCKET ********/
socket.on("roomJoined", (room) => {
  currentRoomId = room.id;
  updateLobby(room);
});

socket.on("roomUpdated", (room) => {
  currentRoomId = room.id;
  updateLobby(room);
});

socket.on("gameStarted", ({ board, boardSize }) => {
  gameOver = false;

  myBoard = board;
  marked = Array.from({ length: boardSize }, () =>
    Array(boardSize).fill(false),
  );

  calledNumbers = [];
  currentCall = null;
  maskedNumbers = new Set();

  doneSentForThisCall = false;
  remainingPlayers = 0;
  pendingNames = [];

  renderBoard(boardSize);
  updateBingoButton();
  show("game");
});

socket.on(
  "turnUpdate",
  ({
    currentTurnIndex: i,
    players: p,
    turnLocked: locked,
    remaining,
    pendingNames: pn,
  }) => {
    currentTurnIndex = i;
    players = p;
    turnLocked = locked;

    remainingPlayers = remaining ?? 0;
    pendingNames = pn ?? [];

    setTurnUI();
    updateBoardUI();
  },
);

socket.on(
  "calledNumbersUpdate",
  ({ calledNumbers: nums, currentCall: call, remaining, pendingNames: pn }) => {
    calledNumbers = nums;
    currentCall = call;

    doneSentForThisCall = false;

    if (typeof remaining === "number") remainingPlayers = remaining;
    if (Array.isArray(pn)) pendingNames = pn;

    if (call) {
      lastCalled.innerText = call.number;

      calledBox.classList.remove("pop");
      void calledBox.offsetWidth;
      calledBox.classList.add("pop");
    } else {
      lastCalled.innerText = "-";
    }

    // if number not in my board, instantly done
    if (call && !boardHasNumber(call.number)) {
      sendDoneOnce();
    }

    startTimer();
    updateBoardUI();
    updateBingoButton();
  },
);

socket.on("winnerDeclared", ({ winnerName: wName }) => {
  gameOver = true;
  winnerName.innerText = `Winner: ${wName}`;
  show("winner");
});

socket.on("errorMsg", (msg) => {
  alert(msg);
});

/******** LOBBY ********/
function updateLobby(room) {
  show("lobby");
  players = room.players;

  roomCode.innerText = room.id;
  roomSize.innerText = room.boardSize;
  roomSize2.innerText = room.boardSize;

  playersList.innerHTML = "";
  players.forEach((p, i) => {
    const li = document.createElement("li");
    li.innerText = p.name;
    li.id = "p" + i;
    playersList.appendChild(li);
  });

  startBtn.style.display = room.hostId === socket.id ? "block" : "none";
}

/******** TURN UI ********/
function setTurnUI() {
  const p = players[currentTurnIndex];
  if (!p) return;

  if (turnLocked) {
    if (pendingNames.length > 0) {
      turnText.innerText = `Marking time ⏳ (Waiting for: ${pendingNames.join(
        ", ",
      )})`;
    } else {
      turnText.innerText = `Marking time ⏳ (Waiting for ${remainingPlayers} player${
        remainingPlayers === 1 ? "" : "s"
      }...)`;
    }
  } else {
    turnText.innerText =
      p.id === socket.id
        ? "Your Turn 🎯 (Tap a cell to CALL)"
        : `Waiting for ${p.name}...`;
  }

  players.forEach((_, i) => {
    const li = document.getElementById("p" + i);
    if (li) li.classList.toggle("active-turn", i === currentTurnIndex);
  });
}

/******** HELPERS ********/
function isMyTurn() {
  return players[currentTurnIndex]?.id === socket.id;
}

function sendDoneOnce() {
  if (doneSentForThisCall) return;
  doneSentForThisCall = true;
  socket.emit("markDone", { roomId: currentRoomId });
  setTurnUI();
}

function boardHasNumber(number) {
  for (let i = 0; i < myBoard.length; i++) {
    for (let j = 0; j < myBoard.length; j++) {
      if (myBoard[i][j] === number) return true;
    }
  }
  return false;
}

/******** BOARD ********/
function renderBoard(size) {
  board.innerHTML = "";
  board.style.gridTemplateColumns = `repeat(${size},1fr)`;

  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const c = document.createElement("div");

      // UI only: entrance animation class
      c.className = "cell enter";

      // UI only: stagger delay so cells appear one by one
      const delay = (i * size + j) * 35; // ms
      c.style.animationDelay = `${delay}ms`;

      c.innerText = myBoard[i][j];
      c.onclick = () => cellClick(i, j, c);
      board.appendChild(c);
    }
  }
}

function cellClick(i, j, cell) {
  if (gameOver) return;

  const num = myBoard[i][j];

  if (maskedNumbers.has(num)) return;

  // CALLING
  if (isMyTurn() && !turnLocked && !calledNumbers.includes(num)) {
    socket.emit("callNumber", { roomId: currentRoomId, number: num });

    marked[i][j] = true;
    cell.classList.add("marked");
    updateBingoButton();

    sendDoneOnce();
    return;
  }

  // MARKING
  if (!currentCall) return;
  if (currentCall.number !== num) return;
  if (Date.now() > currentCall.expiresAt) return;

  marked[i][j] = !marked[i][j];
  cell.classList.toggle("marked");

  updateBingoButton();
  sendDoneOnce();
}

function updateBoardUI() {
  const cells = document.querySelectorAll(".cell");
  const size = myBoard.length;

  cells.forEach((c, idx) => {
    const i = Math.floor(idx / size);
    const j = idx % size;
    const n = myBoard[i][j];

    c.classList.toggle("masked", maskedNumbers.has(n));

    const canCall = isMyTurn() && !turnLocked && !calledNumbers.includes(n);
    c.classList.toggle("callable", canCall);
  });
}

/******** TIMER ********/
function startTimer() {
  clearInterval(timerInt);

  timerInt = setInterval(() => {
    if (!currentCall) {
      timeLeft.innerText = "0";
      return;
    }

    const t = Math.max(
      0,
      Math.ceil((currentCall.expiresAt - Date.now()) / 1000),
    );

    timeLeft.innerText = t;

    // UI only: danger pulse when time is low
    if (t <= 3) {
      timeLeft.style.color = "#ef4444";
      timeLeft.style.textShadow = "0 0 12px rgba(239,68,68,0.7)";
    } else {
      timeLeft.style.color = "white";
      timeLeft.style.textShadow = "none";
    }

    if (t === 0) {
      maskIfMissed(currentCall.number);
      sendDoneOnce();
      updateBoardUI();
      updateBingoButton();
    }

    if (turnLocked) setTurnUI();
  }, 200);
}

function maskIfMissed(number) {
  for (let i = 0; i < myBoard.length; i++) {
    for (let j = 0; j < myBoard.length; j++) {
      if (myBoard[i][j] === number) {
        if (!marked[i][j]) maskedNumbers.add(number);
        return;
      }
    }
  }
}

/******** BINGO ********/
function updateBingoButton() {
  bingoBtn.disabled = !isBingo(marked) || gameOver;
}

function claimBingo() {
  if (gameOver) return;
  if (!isBingo(marked)) return;

  const me = players.find((p) => p.id === socket.id);
  socket.emit("claimBingo", {
    roomId: currentRoomId,
    marked,
    name: me ? me.name : "Player",
  });
}

/******** REMATCH (NO RELOAD) ********/
function rematch() {
  socket.emit("rematch", { roomId: currentRoomId });
  show("game");
}
