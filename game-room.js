'use strict';

const { MAP_CONFIG } = require('./maps');
const { SnakeEngine } = require('./snake-engine');

function safeSend(ws, payload) {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify(payload));
}

class GameRoom {
  constructor(id, players, onClose) {
    this.id = id;
    this.players = players;
    this.engine = new SnakeEngine(players);
    this.tickTimer = null;
    this.broadcastTimer = null;
    this.onClose = onClose;
    this.closed = false;
  }

  start() {
    for (const p of this.players) {
      p.roomId = this.id;
      safeSend(p.ws, {
        type: 'match_found',
        roomId: this.id,
        countdownMs: 5000,
        players: this.players.map((x) => ({ id: x.id, name: x.name })),
      });
    }

    this.tickTimer = setInterval(() => {
      this.engine.step(Date.now());
      if (this.engine.phase === 'ended') {
        const result = this.engine.getResults();
        for (const p of this.players) safeSend(p.ws, result);
        this.stop();
      }
    }, MAP_CONFIG.tickMs);

    this.broadcastTimer = setInterval(() => {
      for (const p of this.players) {
        safeSend(p.ws, this.engine.getStateFor(p.id));
      }
    }, MAP_CONFIG.tickMs);
  }

  handleInput(playerId, dir) {
    this.engine.setInput(playerId, dir);
  }

  spectateNext(playerId) {
    this.engine.spectateNext(playerId);
  }

  removePlayer(playerId) {
    this.engine.eliminatePlayer(playerId, 'disconnected');
    const idx = this.players.findIndex((p) => p.id === playerId);
    if (idx >= 0) {
      this.players.splice(idx, 1);
    }
    if (this.players.length === 0) this.stop();
  }

  stop() {
    if (this.closed) return;
    this.closed = true;
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.broadcastTimer) clearInterval(this.broadcastTimer);
    this.tickTimer = null;
    this.broadcastTimer = null;
    if (this.onClose) this.onClose(this.id);
  }
}

module.exports = {
  GameRoom,
  safeSend,
};
