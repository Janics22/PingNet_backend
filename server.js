
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);

// ============================================
// Configuración de Socket.IO
// ============================================
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});


// ============================================
// Servir archivos estáticos (opcional si quieres servir frontend desde backend)
// ============================================
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

const getServerURL = () => {
  if (process.env.DOMAIN) {
    return `https://${process.env.DOMAIN}`;
  } else {
    return `http://localhost:${PORT}`;
  }
};

server.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log('🏓 Servidor Ping Pong Digital iniciado');
  console.log('========================================');
  console.log(`Puerto: ${PORT}`);
  console.log(`Local: http://localhost:${PORT}`);
  
  if (!process.env.DOMAIN) {
    const os = require('os');
    const networkInterfaces = os.networkInterfaces();
    Object.keys(networkInterfaces).forEach((iface) => {
      networkInterfaces[iface].forEach((i) => {
        if (i.family === 'IPv4' && !i.internal) {
          console.log(`Red local: http://${i.address}:${PORT}`);
        }
      });
    });
  } else {
    console.log(`Dominio: ${getServerURL()}`);
  }
  console.log('========================================');
});

// ============================================
// FUNCIONES DE UTILIDAD
// ============================================

function generateRoomCode(length = 5) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function createInitialGameState(gameType = "normal") {
  const state = {
    playerA: { y: 150 },
    playerB: { y: 150 },
    scoreA: 0,
    scoreB: 0,
    gameType,
    lastEffectTime: Date.now(),
    activeEffects: []
  };

  if (gameType === "normal") {
    state.ball = { x: 400, y: 200, vx: 5, vy: 5 };
  } else {
    state.balls = [{ x: 400, y: 200, vx: 5, vy: 5 }];
  }

  return state;
}

function applySpecialEffects(state) {
  const now = Date.now();

  if (now - state.lastEffectTime > 10000) {
    state.lastEffectTime = now;
    const effects = ['speedBoost', 'doubleBall', 'directionChange'];
    const randomEffect = effects[Math.floor(Math.random() * effects.length)];

    state.activeEffects.push({
      type: randomEffect,
      endsAt: now + 5000
    });

    switch (randomEffect) {
      case 'speedBoost':
        state.balls.forEach(ball => {
          ball.vx *= 1.5;
          ball.vy *= 1.5;
        });
        break;
      case 'doubleBall':
        if (state.balls.length < 2) {
          const newBall = { x: 400, y: 200, vx: -state.balls[0].vx, vy: state.balls[0].vy };
          state.balls.push(newBall);
        }
        break;
      case 'directionChange':
        state.balls.forEach(ball => {
          ball.vx = -ball.vx;
          ball.vy = Math.random() > 0.5 ? ball.vy : -ball.vy;
        });
        break;
    }
  }

  // Limpiar efectos expirados
  state.activeEffects = state.activeEffects.filter(effect => {
    if (effect.endsAt < now) {
      switch (effect.type) {
        case 'speedBoost':
          state.balls.forEach(ball => {
            ball.vx /= 1.5;
            ball.vy /= 1.5;
          });
          break;
        case 'doubleBall':
          if (state.balls.length > 1) state.balls = [state.balls[0]];
          break;
      }
      return false;
    }
    return true;
  });
}

// ============================================
// ALMACENAMIENTO DE JUEGOS
// ============================================
const games = {};
const intervals = {};

// ============================================
// Socket.IO - GESTIÓN DE CONEXIONES
// ============================================
io.on("connection", (socket) => {
  console.log(`✅ Usuario conectado: ${socket.id}`);

  socket.on("createRoom", (gameType) => {
    let roomId;
    do {
      roomId = generateRoomCode();
    } while (games[roomId]);

    games[roomId] = {
      players: { playerA: socket.id },
      gameState: createInitialGameState(gameType),
      gameType
    };

    socket.join(roomId);
    socket.emit("roomCreated", roomId);
    console.log(`🎮 Sala creada: ${roomId} (${gameType})`);
  });

  socket.on("joinRoom", (roomId) => {
    const game = games[roomId];
    if (!game) {
      socket.emit("errorMsg", "Sala no existe.");
      return;
    }
    if (game.players.playerB) {
      socket.emit("roomFull");
      return;
    }

    game.players.playerB = socket.id;
    socket.join(roomId);
    socket.emit("roomJoined", roomId);
    io.to(roomId).emit("startGame", game.gameType);

    if (!intervals[roomId]) {
      intervals[roomId] = setInterval(() => updateGame(roomId), 1000/60);
    }
  });

  socket.on("paddleMove", ({ roomId, role, y }) => {
    const game = games[roomId];
    if (!game) return;

    if (role === "playerA") game.gameState.playerA.y = y;
    else if (role === "playerB") game.gameState.playerB.y = y;

    io.to(roomId).emit("gameState", game.gameState);
  });

  socket.on("endGame", (roomId) => {
    const room = games[roomId];
    if (room) {
      io.to(roomId).emit("gameEnded");
      clearInterval(intervals[roomId]);
      delete games[roomId];
      delete intervals[roomId];
    }
  });

  socket.on("disconnect", () => {
    for (const roomId in games) {
      const game = games[roomId];

      if (game.players.playerA === socket.id) delete game.players.playerA;
      if (game.players.playerB === socket.id) delete game.players.playerB;

      if (!game.players.playerA && !game.players.playerB) {
        clearInterval(intervals[roomId]);
        delete games[roomId];
        delete intervals[roomId];
      }
    }
  });
});

// ============================================
// LÓGICA DEL JUEGO
// ============================================

function updateGame(roomId) {
  const game = games[roomId];
  if (!game) return;

  const state = game.gameState;
  const gameType = game.gameType;

  if (gameType === "special") applySpecialEffects(state);

  if (gameType === "normal") updateNormalGame(state);
  else updateSpecialGame(state);

  io.to(roomId).emit("gameState", state);
}

function updateNormalGame(state) {
  const ball = state.ball;
  ball.x += ball.vx;
  ball.y += ball.vy;

  if (ball.y < 10 || ball.y > 390) ball.vy = -ball.vy;

  const maxSpeed = 15;
  const speedIncrement = 0.25;

  // Rebote en paletas
  if (ball.x < 30 && ball.y > state.playerA.y && ball.y < state.playerA.y + 100 && ball.vx < 0) {
    ball.vx = -ball.vx;
    if (Math.abs(ball.vx) < maxSpeed) ball.vx += ball.vx > 0 ? speedIncrement : -speedIncrement;
    if (Math.abs(ball.vy) < maxSpeed) ball.vy += ball.vy > 0 ? speedIncrement/2 : -speedIncrement/2;
  }

  if (ball.x > 770 && ball.y > state.playerB.y && ball.y < state.playerB.y + 100 && ball.vx > 0) {
    ball.vx = -ball.vx;
    if (Math.abs(ball.vx) < maxSpeed) ball.vx += ball.vx > 0 ? speedIncrement : -speedIncrement;
    if (Math.abs(ball.vy) < maxSpeed) ball.vy += ball.vy > 0 ? speedIncrement/2 : -speedIncrement/2;
  }

  if (ball.x < 0) { state.scoreB++; resetBall(state, "normal"); }
  else if (ball.x > 800) { state.scoreA++; resetBall(state, "normal"); }
}

function updateSpecialGame(state) {
  state.balls.forEach(ball => {
    ball.x += ball.vx;
    ball.y += ball.vy;

    if (ball.y < 10 || ball.y > 390) ball.vy = -ball.vy;

    const maxSpeed = 15;
    const speedIncrement = 0.25;

    // Rebote en paletas
    if (ball.x < 30 && ball.y > state.playerA.y && ball.y < state.playerA.y + 100 && ball.vx < 0) {
      ball.vx = -ball.vx;
      if (Math.abs(ball.vx) < maxSpeed) ball.vx += ball.vx > 0 ? speedIncrement : -speedIncrement;
      if (Math.abs(ball.vy) < maxSpeed) ball.vy += ball.vy > 0 ? speedIncrement/2 : -speedIncrement/2;
    }

    if (ball.x > 770 && ball.y > state.playerB.y && ball.y < state.playerB.y + 100 && ball.vx > 0) {
      ball.vx = -ball.vx;
      if (Math.abs(ball.vx) < maxSpeed) ball.vx += ball.vx > 0 ? speedIncrement : -speedIncrement;
      if (Math.abs(ball.vy) < maxSpeed) ball.vy += ball.vy > 0 ? speedIncrement/2 : -speedIncrement/2;
    }

    if (ball.x < 0) { state.scoreB++; resetBall(state, "special", ball); }
    else if (ball.x > 800) { state.scoreA++; resetBall(state, "special", ball); }
  });
}

function resetBall(state, gameType, ball = null) {
  if (gameType === "normal") {
    state.ball.x = 400;
    state.ball.y = 200;
    state.ball.vx = -state.ball.vx;
  } else if (gameType === "special" && ball) {
    ball.x = 400;
    ball.y = 200;
    ball.vx = Math.random() > 0.5 ? 5 : -5;
    ball.vy = Math.random() * 10 - 5;
  }
}



