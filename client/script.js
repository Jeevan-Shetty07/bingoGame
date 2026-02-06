// client/script.js
// --- CONFIGURATION & INITIALIZATION ---
let socket = io();
let vantaEffect = null;

// Initialize Vanta Background
window.addEventListener('DOMContentLoaded', () => {
    vantaEffect = VANTA.NET({
        el: "#vanta-bg",
        mouseControls: true,
        touchControls: true,
        gyroControls: false,
        minHeight: 200.00,
        minWidth: 200.00,
        scale: 1.00,
        scaleMobile: 1.00,
        color: 0x00f2ff, // Primary Cyan
        backgroundColor: 0x0d111c,
        points: 10.00,
        maxDistance: 20.00,
        spacing: 15.00
    });
});

/******** STATE ********/
let currentRoomId = null;
let players = [];
let currentTurnIndex = 0;
let turnLocked = false;

let myBoard = [];
let marked = [];
let calledNumbers = [];
let currentCall = null;
let myName = "";
let unreadCount = 0;
let chatOpen = false;

let timerInt = null;
let gameOver = false;
let gameStartTime = 0;

let maskedNumbers = new Set();
let doneSentForThisCall = false;

let remainingPlayers = 0;
let pendingNames = [];

/******** SCREEN ********/
function show(id) {
  const screens = document.querySelectorAll(".screen");
  const sideView = document.querySelector(".side-view");
  const mobileToggle = document.getElementById("chatMobileBtn");

  screens.forEach((s) => {
    s.classList.remove("active");
    s.style.display = "none";
  });

  const target = document.getElementById(id);
  if (target) {
    target.style.display = "flex";
    target.classList.add("active");

    // GSAP Cinematic Entrance
    const directChildren = target.children;
    gsap.fromTo(directChildren, 
      { opacity: 0, y: 20, scale: 0.95 },
      { opacity: 1, y: 0, scale: 1, duration: 0.5, stagger: 0.1, ease: "power2.out" }
    );
    
    // Additional "juice" for specific screens
    if (id === 'winner') {
      confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#00f2ff', '#7000ff', '#ffffff']
      });
    }
  }

  // Sidebar Visibility Management
  const sidebarScreens = ["home", "create", "join"];
  if (sideView) {
    if (sidebarScreens.includes(id)) {
      sideView.style.display = "none";
      if (mobileToggle) mobileToggle.style.display = "none";
    } else {
      // For game sessions, manage sidebar based on width
      if (window.innerWidth > 900) {
        sideView.style.display = "flex";
        sideView.classList.remove("open");
        if (mobileToggle) mobileToggle.style.display = "none";
      } else {
        // KEEP FLEX on mobile so the CSS transform slide-in works!
        sideView.style.display = "flex"; 
        sideView.classList.toggle("open", chatOpen);
        if (mobileToggle) mobileToggle.style.display = "flex";
      }
    }
  }
}

// Set initial state
show("home");

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

function toggleChatDrawer() {
  if (window.innerWidth > 900) return; 
  
  const sideView = document.querySelector(".side-view");
  chatOpen = !chatOpen;
  
  if (sideView) sideView.classList.toggle("open", chatOpen);
  
  if (chatOpen) {
    unreadCount = 0;
    updateChatBadge();
  }
}

function updateChatBadge() {
  const badge = document.getElementById("unreadBadge");
  const mobileBadge = document.getElementById("unreadBadgeMobile");
  
  if (badge) {
    badge.innerText = unreadCount;
    badge.classList.toggle("show", unreadCount > 0);
  }
  
  if (mobileBadge) {
    mobileBadge.innerText = unreadCount;
    // Check if unreadCount > 0 to show badge
    if (unreadCount > 0) {
      mobileBadge.style.display = "block";
      mobileBadge.innerText = unreadCount;
    } else {
      mobileBadge.style.display = "none";
    }
  }
}

function sendChatMessage() {
  const input = document.getElementById("chatInput");
  const msg = input.value.trim();
  if (!msg || !currentRoomId) return;

  socket.emit("sendMessage", {
    roomId: currentRoomId,
    message: msg,
    name: myName || "User"
  });
  input.value = "";
}

function checkChatEnter(e) {
  if (e.key === "Enter") sendChatMessage();
}
function copyRoomCode() {
  const code = roomCode?.innerText?.trim();
  if (!code) return alert("Room code not available yet!");

  navigator.clipboard.writeText(code)
    .then(() => {
      showToast("Room code copied! 📋✅");

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
  myName = name;
  socket.emit("createRoom", { name, boardSize: size });
}

function joinRoom() {
  const name = joinName.value.trim();
  const roomId = joinRoomId.value.trim();
  if (!name || !roomId) return alert("Fill all fields");
  myName = name;
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

  gameStartTime = Date.now();
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

      // AUTOMATIC MARKING: When a number is called, find it and mark it
      markNumberOnBoard(call.number);
    } else {
      lastCalled.innerText = "-";
    }

    startTimer();
    updateBoardUI();
    updateBingoButton();

    // Since it's automatic now, we can instantly send done
    if (call) {
      setTimeout(() => sendDoneOnce(), 500); // Small delay for visual feel
    }
  },
);

function markNumberOnBoard(num) {
  for (let i = 0; i < myBoard.length; i++) {
    for (let j = 0; j < myBoard.length; j++) {
      if (myBoard[i][j] === num) {
        marked[i][j] = true;
        // Find cell and add marked class
        const cells = document.querySelectorAll(".cell");
        const idx = i * myBoard.length + j;
        if (cells[idx]) cells[idx].classList.add("marked");
        return true;
      }
    }
  }
  return false;
}

socket.on("winnerDeclared", ({ winnerName: wName }) => {
  gameOver = true;
  winnerName.innerText = wName;
  
  // Stats
  document.getElementById("totalCalls").innerText = calledNumbers.length;
  const elapsed = Math.floor((Date.now() - gameStartTime) / 1000);
  document.getElementById("totalTime").innerText = `${elapsed}s`;

  // Flash
  const flash = document.getElementById("victoryFlash");
  flash.classList.remove("flash-anim");
  void flash.offsetWidth;
  flash.classList.add("flash-anim");

  show("winner");
});

socket.on("errorMsg", (msg) => {
  alert(msg);
});

socket.on("receiveMessage", ({ name, message, time }) => {
  const container = document.getElementById("chatMessages");
  if (!container) return;
  const isMe = name === myName;

  const msgDiv = document.createElement("div");
  msgDiv.className = `msg ${isMe ? "me" : ""}`;
  msgDiv.innerHTML = `
    <div class="sender">${name}</div>
    <div class="content">${message}</div>
    <div class="time">${time}</div>
  `;
  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;

  // Only show unread badger on mobile toggle
  if (!chatOpen && window.innerWidth <= 900) {
    unreadCount++;
    updateChatBadge();
  }
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

  const nodeCountEl = document.getElementById("nodeCount");
  if (nodeCountEl) nodeCountEl.innerText = players.length.toString().padStart(2, "0");

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
  const completedLines = countBingoLines(marked);
  updateProgressUI(completedLines);
  bingoBtn.disabled = completedLines < 5 || gameOver;
}

function countBingoLines(m) {
  let lines = 0;
  const size = m.length;

  // Rows
  for (let i = 0; i < size; i++) {
    if (m[i].every(v => v)) lines++;
  }
  // Cols
  for (let j = 0; j < size; j++) {
    let col = true;
    for (let i = 0; i < size; i++) {
        if (!m[i][j]) { col = false; break; }
    }
    if (col) lines++;
  }
  // Diagonals
  let d1 = true, d2 = true;
  for (let i = 0; i < size; i++) {
    if (!m[i][i]) d1 = false;
    if (!m[i][size - 1 - i]) d2 = false;
  }
  if (d1) lines++;
  if (d2) lines++;

  return lines;
}

function updateProgressUI(lines) {
  const letters = document.querySelectorAll(".bingoProgress .letter");
  letters.forEach((l, i) => {
    l.classList.toggle("active", i < lines);
  });
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
function showToast(msg) {
  const t = document.getElementById("toast");
  if (!t) return alert(msg);

  t.innerText = msg;
  t.classList.add("show");

  setTimeout(() => t.classList.remove("show"), 1200);
}
