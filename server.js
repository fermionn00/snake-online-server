'use strict';

const http = require('http');
const { WebSocketServer } = require('ws');
const { MAP_CONFIG } = require('./maps');
const { GameRoom, safeSend } = require('./game-room');

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;

/* --- Shared backlog feedback storage --- */
const feedbackItems = [];
const MAX_FEEDBACK = 200;

/* --- Global leaderboard storage --- */
const leaderboard = { byKills: [], byLength: [] };
const MAX_LEADERBOARD = 20;

function addToLeaderboard(entry) {
  /* entry: { name, kills, maxLength, date } */
  leaderboard.byKills.push(entry);
  leaderboard.byKills.sort((a, b) => b.kills - a.kills);
  if (leaderboard.byKills.length > MAX_LEADERBOARD) leaderboard.byKills.length = MAX_LEADERBOARD;
  leaderboard.byLength.push(entry);
  leaderboard.byLength.sort((a, b) => b.maxLength - a.maxLength);
  if (leaderboard.byLength.length > MAX_LEADERBOARD) leaderboard.byLength.length = MAX_LEADERBOARD;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolve(body));
  });
}

const server = http.createServer(async (req, res) => {
  /* CORS preflight */
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, service: 'snake-online-server' }));
    return;
  }

  /* GET /api/backlog — return all feedback items */
  if (req.url === '/api/backlog' && req.method === 'GET') {
    res.writeHead(200, corsHeaders());
    res.end(JSON.stringify({ ok: true, items: feedbackItems, count: feedbackItems.length }));
    return;
  }

  /* POST /api/backlog — add a new feedback item */
  if (req.url === '/api/backlog' && req.method === 'POST') {
    try {
      const raw = await readBody(req);
      const data = JSON.parse(raw);
      const text = String(data.text || '').trim().slice(0, 200);
      const group = String(data.group || 'Gameplay').trim().slice(0, 30);
      const author = String(data.author || 'Ẩn danh').trim().slice(0, 30);
      if (!text) {
        res.writeHead(400, corsHeaders());
        res.end(JSON.stringify({ ok: false, error: 'text is required' }));
        return;
      }
      const item = {
        id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        text,
        group,
        author,
        createdAt: new Date().toISOString(),
      };
      feedbackItems.push(item);
      if (feedbackItems.length > MAX_FEEDBACK) feedbackItems.shift();
      console.log(`[backlog] New feedback from ${author}: [${group}] ${text}`);
      res.writeHead(201, corsHeaders());
      res.end(JSON.stringify({ ok: true, item }));
    } catch (err) {
      res.writeHead(400, corsHeaders());
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
    return;
  }

  /* GET /api/leaderboard — return top kills + top length */
  if (req.url === '/api/leaderboard' && req.method === 'GET') {
    res.writeHead(200, corsHeaders());
    res.end(JSON.stringify({ ok: true, byKills: leaderboard.byKills, byLength: leaderboard.byLength }));
    return;
  }

  /* GET /api/rooms — list active rooms for spectating */
  if (req.url === '/api/rooms' && req.method === 'GET') {
    const activeRooms = [];
    for (const [id, room] of rooms) {
      if (!room.closed) {
        activeRooms.push({
          id,
          players: room.players.length,
          phase: room.engine ? room.engine.phase : 'unknown',
        });
      }
    }
    res.writeHead(200, corsHeaders());
    res.end(JSON.stringify({ ok: true, rooms: activeRooms }));
    return;
  }

  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Snake Online WebSocket server is running.');
});

const wss = new WebSocketServer({ server });

let nextPlayerId = 1;
let nextRoomId = 1;
const clients = new Map();
const queue = [];
const queue1v1 = [];
const rooms = new Map();
let queueSince = null;

function queueCount() {
  return queue.length;
}

function broadcastQueueStatus() {
  const payload = {
    type: 'queue_update',
    queued: queueCount(),
    min: MAP_CONFIG.minPlayersToStart,
    max: MAP_CONFIG.maxPlayers,
  };
  for (const c of clients.values()) {
    if (c.inQueue && !c.roomId) safeSend(c.ws, payload);
  }
}

function removeFromQueue(playerId) {
  const idx = queue.findIndex((x) => x.id === playerId);
  if (idx >= 0) queue.splice(idx, 1);
  if (queue.length === 0) queueSince = null;
  broadcastQueueStatus();
}

function createRoom(roomPlayers) {
  const roomId = `room-${nextRoomId++}`;
  const room = new GameRoom(roomId, roomPlayers, (closedId) => {
    rooms.delete(closedId);
    /* Save match results to leaderboard */
    if (room.engine) {
      const results = room.engine.getResults();
      if (results && results.standings) {
        for (const s of results.standings) {
          addToLeaderboard({
            name: s.name || `P${s.id}`,
            kills: s.kills || 0,
            maxLength: s.maxLength || 0,
            date: new Date().toISOString(),
          });
        }
      }
    }
    for (const c of clients.values()) {
      if (c.roomId === closedId) c.roomId = null;
    }
  });
  rooms.set(roomId, room);
  room.start();
  return room;
}

function maybeStartMatch() {
  if (queue.length < MAP_CONFIG.minPlayersToStart) return;

  const roomSize = Math.min(MAP_CONFIG.maxPlayers, queue.length);
  const roomPlayers = queue.splice(0, roomSize);
  for (const p of roomPlayers) p.inQueue = false;
  if (queue.length === 0) queueSince = null;
  else queueSince = Date.now();

  createRoom(roomPlayers);
  broadcastQueueStatus();
}

function maybeStart1v1() {
  if (queue1v1.length < 2) return;
  const roomPlayers = queue1v1.splice(0, 2);
  for (const p of roomPlayers) p.inQueue = false;
  createRoom(roomPlayers);
  broadcast1v1Status();
}

function broadcast1v1Status() {
  const payload = { type: 'queue_update', queued: queue1v1.length, min: 2, max: 2, mode: '1v1' };
  for (const c of clients.values()) {
    if (c.in1v1Queue && !c.roomId) safeSend(c.ws, payload);
  }
}

function attachPlayer(ws) {
  const player = {
    id: nextPlayerId++,
    ws,
    name: '',
    roomId: null,
    inQueue: false,
    in1v1Queue: false,
    spectating: false,
  };
  clients.set(player.id, player);
  return player;
}

function removeFrom1v1Queue(playerId) {
  const idx = queue1v1.findIndex((x) => x.id === playerId);
  if (idx >= 0) queue1v1.splice(idx, 1);
  broadcast1v1Status();
}

function cleanupClient(player) {
  if (!player) return;
  if (player.inQueue) removeFromQueue(player.id);
  if (player.in1v1Queue) removeFrom1v1Queue(player.id);
  if (player.roomId && !player.spectating) {
    const room = rooms.get(player.roomId);
    if (room) room.removePlayer(player.id);
  }
  clients.delete(player.id);
}

wss.on('connection', (ws) => {
  const player = attachPlayer(ws);

  safeSend(ws, {
    type: 'hello',
    playerId: player.id,
    message: 'Connected to Snake Online server',
  });

  ws.on('message', (raw) => {
    let msg = null;
    try {
      msg = JSON.parse(raw.toString());
    } catch (err) {
      safeSend(ws, { type: 'error', message: 'Invalid JSON payload' });
      return;
    }

    if (msg.type === 'join_queue') {
      if (player.inQueue || player.roomId) return;
      player.name = String(msg.name || '').trim().slice(0, 16) || `P${player.id}`;
      player.skinIndex = typeof msg.skinIndex === 'number' ? Math.max(0, Math.min(7, Math.floor(msg.skinIndex))) : 0;
      player.inQueue = true;
      queue.push(player);
      if (!queueSince) queueSince = Date.now();
      safeSend(ws, {
        type: 'queue_joined',
        playerId: player.id,
        name: player.name,
      });
      broadcastQueueStatus();
      maybeStartMatch();
      return;
    }

    if (msg.type === 'leave_queue') {
      if (!player.inQueue) return;
      player.inQueue = false;
      removeFromQueue(player.id);
      safeSend(ws, { type: 'queue_left' });
      return;
    }

    if (msg.type === 'input') {
      if (!player.roomId || typeof msg.dir !== 'string') return;
      const room = rooms.get(player.roomId);
      if (!room) return;
      room.handleInput(player.id, msg.dir);
      return;
    }

    if (msg.type === 'spectate_next') {
      if (!player.roomId) return;
      const room = rooms.get(player.roomId);
      if (!room) return;
      room.spectateNext(player.id);
      return;
    }

    if (msg.type === 'chat') {
      const text = String(msg.text || '').trim().slice(0, 100);
      if (!text) return;
      const chatPayload = {
        type: 'chat',
        from: player.name || `P${player.id}`,
        playerId: player.id,
        text: text,
        time: Date.now(),
      };
      /* Broadcast to all clients in queue or same room */
      for (const c of clients.values()) {
        if (player.roomId && c.roomId === player.roomId) {
          safeSend(c.ws, chatPayload);
        } else if (!player.roomId && !c.roomId) {
          safeSend(c.ws, chatPayload);
        }
      }
      return;
    }

    /* --- 1v1 Queue --- */
    if (msg.type === 'join_1v1') {
      if (player.inQueue || player.in1v1Queue || player.roomId) return;
      player.name = String(msg.name || '').trim().slice(0, 16) || `P${player.id}`;
      player.skinIndex = typeof msg.skinIndex === 'number' ? Math.max(0, Math.min(7, Math.floor(msg.skinIndex))) : 0;
      player.in1v1Queue = true;
      queue1v1.push(player);
      safeSend(ws, { type: 'queue_joined', playerId: player.id, name: player.name, mode: '1v1' });
      broadcast1v1Status();
      maybeStart1v1();
      return;
    }

    if (msg.type === 'leave_1v1') {
      if (!player.in1v1Queue) return;
      player.in1v1Queue = false;
      removeFrom1v1Queue(player.id);
      safeSend(ws, { type: 'queue_left', mode: '1v1' });
      return;
    }

    /* --- Spectate from lobby --- */
    if (msg.type === 'spectate_room') {
      const roomId = msg.roomId;
      const room = roomId ? rooms.get(roomId) : null;
      /* If no roomId specified, pick first active room */
      let targetRoom = room;
      if (!targetRoom) {
        for (const [, r] of rooms) {
          if (!r.closed) { targetRoom = r; break; }
        }
      }
      if (!targetRoom) {
        safeSend(ws, { type: 'error', message: 'Không có phòng nào đang chơi' });
        return;
      }
      player.roomId = targetRoom.id;
      player.spectating = true;
      player.name = player.name || `Spectator${player.id}`;
      targetRoom.players.push(player);
      /* Mark as dead spectator in engine */
      targetRoom.engine.addSpectator(player.id);
      safeSend(ws, { type: 'spectate_joined', roomId: targetRoom.id });
      return;
    }
  });

  ws.on('close', () => cleanupClient(player));
  ws.on('error', () => cleanupClient(player));
});

setInterval(() => {
  if (queue.length >= MAP_CONFIG.minPlayersToStart) maybeStartMatch();
  if (queue1v1.length >= 2) maybeStart1v1();
}, 1000);

server.listen(PORT, () => {
  console.log(`[snake-online] HTTP+WS server running on port ${PORT}`);
});
