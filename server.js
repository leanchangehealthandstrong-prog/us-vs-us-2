const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;

const rooms = new Map();

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let code;

  do {
    code = "";

    for (let i = 0; i < 5; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }

  } while (rooms.has(code));

  return code;
}

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(room, data) {
  room.players.forEach(player => {
    send(player.ws, data);
  });
}

function publicPlayers(room) {
  return room.players.map((player, index) => ({
    slot: index,
    name: player.name,
    score: player.score || 0,
    connected: player.ws && player.ws.readyState === WebSocket.OPEN
  }));
}

function broadcastState(room) {
  broadcast(room, {
    type: "state",
    room: room.code,
    players: publicPlayers(room),
    turn: room.turn,
    started: room.players.length === 2
  });
}

function findPlayer(room, ws) {
  return room.players.find(player => player.ws === ws);
}

function sendPlayers(room) {
  broadcast(room, {
    type: "players",
    players: publicPlayers(room),
    turn: room.turn,
    started: room.players.length === 2
  });
}

/* ---------------- HTTP SERVER ---------------- */

const server = http.createServer((req, res) => {

  let filePath;

  if (req.url === "/" || req.url === "/index.html") {
    filePath = path.join(__dirname, "public", "index.html");
  } else {
    filePath = path.join(__dirname, "public", req.url);
  }

  if (!filePath.startsWith(path.join(__dirname, "public"))) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(filePath, (err, data) => {

    if (err) {
      res.writeHead(404);
      return res.end("Not found");
    }

    let contentType = "text/html";

    if (filePath.endsWith(".js")) {
      contentType = "application/javascript";
    }

    if (filePath.endsWith(".css")) {
      contentType = "text/css";
    }

    res.writeHead(200, {
      "Content-Type": contentType
    });

    res.end(data);
  });

});

/* ---------------- WEBSOCKET SERVER ---------------- */

const wss = new WebSocket.Server({ server });

wss.on("connection", ws => {

  ws.alive = true;
  ws.room = null;

  ws.on("pong", () => {
    ws.alive = true;
  });

  ws.on("message", raw => {

    let message;

    try {
      message = JSON.parse(raw.toString());
    } catch {
      return send(ws, {
        type: "error",
        message: "Invalid message."
      });
    }

    /* CREATE ROOM */

    if (message.type === "create") {

      const code = makeRoomCode();

      const player = {
        ws,
        name: String(message.name || "Player 1").slice(0, 20),
        score: 0
      };

      const room = {
        code,
        players: [player],
        turn: 0,
        challenge: null,
        started: false
      };

      rooms.set(code, room);
      ws.room = code;

      send(ws, {
        type: "room",
        code,
        slot: 0,
        name: player.name,
        players: publicPlayers(room),
        turn: room.turn,
        started: false
      });

      return;
    }

    /* JOIN ROOM */

    if (message.type === "join") {

      const code = String(message.code || "")
        .trim()
        .toUpperCase();

      const room = rooms.get(code);

      if (!room) {
        return send(ws, {
          type: "error",
          message: "Room not found. Check the room code."
        });
      }

      if (room.players.length >= 2) {
        return send(ws, {
          type: "error",
          message: "This room already has two players."
        });
      }

      const player = {
        ws,
        name: String(message.name || "Player 2").slice(0, 20),
        score: 0
      };

      room.players.push(player);

      ws.room = code;

      send(ws, {
        type: "room",
        code,
        slot: 1,
        name: player.name,
        players: publicPlayers(room),
        turn: room.turn,
        started: true
      });

      broadcast(room, {
        type: "joined",
        players: publicPlayers(room),
        turn: room.turn,
        started: true
      });

      broadcastState(room);

      return;
    }

    /* EVERYTHING BELOW REQUIRES A ROOM */

    const room = ws.room ? rooms.get(ws.room) : null;

    if (!room) {
      return send(ws, {
        type: "error",
        message: "You are not in a room."
      });
    }

    const player = findPlayer(room, ws);

    if (!player) {
      return;
    }

    /* CLAIM TURN */

    if (message.type === "claimTurn") {

      if (room.players.length < 2) {
        return send(ws, {
          type: "error",
          message: "Waiting for the other player to join."
        });
      }

      const slot = room.players.indexOf(player);

      if (slot !== room.turn) {
        return send(ws, {
          type: "error",
          message: "It is not your turn."
        });
      }

      send(ws, {
        type: "turnConfirmed",
        turn: room.turn
      });

      return;
    }

    /* NEXT TURN */

    if (
      message.type === "nextTurn" ||
      message.type === "endTurn"
    ) {

      const slot = room.players.indexOf(player);

      if (slot !== room.turn) {
        return send(ws, {
          type: "error",
          message: "You cannot end the other player's turn."
        });
      }

      room.turn = room.turn === 0 ? 1 : 0;

      broadcast(room, {
        type: "turn",
        turn: room.turn
      });

      broadcastState(room);

      return;
    }

    /* SCORE */

    if (message.type === "score") {

      const points = Number(message.points || 0);

      if (!Number.isFinite(points)) {
        return;
      }

      player.score += points;

      broadcast(room, {
        type: "score",
        slot: room.players.indexOf(player),
        points,
        players: publicPlayers(room)
      });

      broadcastState(room);

      /* WINNER */

      if (player.score >= 50) {

        broadcast(room, {
          type: "winner",
          winner: room.players.indexOf(player),
          name: player.name,
          score: player.score
        });
      }

      return;
    }

    /* CHALLENGE */

    if (message.type === "challenge") {

      room.challenge = message.challenge || null;

      broadcast(room, {
        type: "challenge",
        challenge: room.challenge
      });

      return;
    }

    /* READY */

    if (message.type === "ready") {

      player.ready = true;

      const everyoneReady =
        room.players.length === 2 &&
        room.players.every(p => p.ready);

      if (everyoneReady) {

        room.turn = 0;

        broadcast(room, {
          type: "gameStart",
          turn: room.turn,
          players: publicPlayers(room)
        });

        broadcastState(room);
      }

      return;
    }

    /* PING */

    if (message.type === "ping") {

      return send(ws, {
        type: "pong"
      });
    }

  });

  /* ---------------- DISCONNECT ---------------- */

  ws.on("close", () => {

    const room = ws.room ? rooms.get(ws.room) : null;

    if (!room) {
      return;
    }

    const index = room.players.findIndex(
      player => player.ws === ws
    );

    if (index !== -1) {

      const leavingPlayer = room.players[index];

      room.players.splice(index, 1);

      broadcast(room, {
        type: "left",
        name: leavingPlayer.name,
        players: publicPlayers(room),
        message: `${leavingPlayer.name} left the game.`
      });

      if (room.players.length === 1) {
        room.turn = 0;
        room.players[0].ready = false;
      }

      if (room.players.length === 0) {
        rooms.delete(room.code);
      } else {
        broadcastState(room);
      }
    }

  });

});

/* ---------------- HEARTBEAT ---------------- */

setInterval(() => {

  wss.clients.forEach(ws => {

    if (!ws.alive) {
      return ws.terminate();
    }

    ws.alive = false;
    ws.ping();

  });

}, 30000);

/* ---------------- START SERVER ---------------- */

server.listen(PORT, "0.0.0.0", () => {
  console.log(`❤️ Us vs Us 2.1 running on port ${PORT}`);
});
