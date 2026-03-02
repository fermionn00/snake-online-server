'use strict';

const { MAP_CONFIG, SPAWN_POINTS, SNAKE_COLORS, FRUIT_CONFIG } = require('./maps');

const DIRS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const OPPOSITE = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
};

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function keyOf(x, y) {
  return `${x},${y}`;
}

class SnakeEngine {
  constructor(players) {
    this.players = players.map((p, idx) => ({
      id: p.id,
      name: p.name || `P${idx + 1}`,
      colorIndex: idx % SNAKE_COLORS.length,
      skinIndex: typeof p.skinIndex === 'number' ? p.skinIndex : 0,
      ws: p.ws,
      spectatingId: null,
      stats: {
        kills: 0,
        fruitsEaten: 0,
        maxLength: MAP_CONFIG.initialSnakeLength,
      },
    }));

    this.snakes = new Map();
    this.fruits = [];
    this.pendingFruitRespawns = [];
    this.killFeed = [];
    this.tick = 0;
    this.phase = 'countdown';
    this.createdAt = Date.now();
    this.countdownMs = 5000;
    this.matchStartAt = this.createdAt + this.countdownMs;
    this.endedAt = null;
    this.lastAliveAnnouncement = null;

    this.#initSnakes();
    this.#initFruits();
  }

  #initSnakes() {
    this.players.forEach((player, i) => {
      const spawn = SPAWN_POINTS[i % SPAWN_POINTS.length];
      const parts = [];
      const v = DIRS[spawn.dir];
      for (let k = 0; k < MAP_CONFIG.initialSnakeLength; k++) {
        parts.push({ x: spawn.x - v.x * k, y: spawn.y - v.y * k });
      }
      this.snakes.set(player.id, {
        id: player.id,
        name: player.name,
        colorIndex: player.colorIndex,
        skinIndex: player.skinIndex,
        segments: parts,
        dir: spawn.dir,
        nextDir: spawn.dir,
        alive: true,
        deathTick: null,
        rank: null,
      });
    });
  }

  #initFruits() {
    const occupied = this.#buildOccupiedSet();
    for (const cfg of FRUIT_CONFIG) {
      if (cfg.kind === 'corpse' || cfg.target <= 0) continue;
      for (let i = 0; i < cfg.target; i++) {
        const pos = this.#findFreeCellFromOccupied(occupied);
        if (!pos) continue;
        this.fruits.push({
          id: `${cfg.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          kind: cfg.kind,
          emoji: cfg.emoji,
          growth: cfg.growth,
          color: cfg.color,
          x: pos.x,
          y: pos.y,
          expiresAt: null,
        });
      }
    }
  }

  #aliveCount() {
    let c = 0;
    for (const s of this.snakes.values()) if (s.alive) c += 1;
    return c;
  }

  #buildOccupiedSet() {
    const occupied = new Set();
    for (const s of this.snakes.values()) {
      for (const part of s.segments) occupied.add(keyOf(part.x, part.y));
    }
    for (const f of this.fruits) occupied.add(keyOf(f.x, f.y));
    return occupied;
  }

  #findFreeCellFromOccupied(occupied, maxTry = 500) {
    if (!occupied) return null;

    for (let i = 0; i < maxTry; i++) {
      const x = randInt(0, MAP_CONFIG.width - 1);
      const y = randInt(0, MAP_CONFIG.height - 1);
      const k = keyOf(x, y);
      if (!occupied.has(k)) {
        occupied.add(k);
        return { x, y };
      }
    }
    return null;
  }

  #findFreeCell(maxTry = 500) {
    const occupied = this.#buildOccupiedSet();
    return this.#findFreeCellFromOccupied(occupied, maxTry);
  }

  #scheduleFruitRespawn(kind) {
    const cfg = FRUIT_CONFIG.find((f) => f.kind === kind);
    if (!cfg || kind === 'corpse') return;
    const delay = randInt(cfg.respawnMinMs, cfg.respawnMaxMs);
    this.pendingFruitRespawns.push({ kind, dueAt: Date.now() + delay });
  }

  #flushExpiredCorpseFruits(now) {
    this.fruits = this.fruits.filter((f) => !f.expiresAt || f.expiresAt > now);
  }

  #flushFruitRespawns(now) {
    if (this.pendingFruitRespawns.length === 0) return;
    const due = [];
    const waiting = [];
    for (const p of this.pendingFruitRespawns) {
      if (p.dueAt <= now) due.push(p);
      else waiting.push(p);
    }
    this.pendingFruitRespawns = waiting;
    const occupied = this.#buildOccupiedSet();

    for (const item of due) {
      const cfg = FRUIT_CONFIG.find((f) => f.kind === item.kind);
      const pos = this.#findFreeCellFromOccupied(occupied);
      if (!cfg || !pos) continue;
      this.fruits.push({
        id: `${cfg.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: cfg.kind,
        emoji: cfg.emoji,
        growth: cfg.growth,
        color: cfg.color,
        x: pos.x,
        y: pos.y,
        expiresAt: null,
      });
    }
  }

  #addKillFeed(text, highlightIds = []) {
    this.killFeed.push({ text, highlightIds, createdAt: Date.now() });
    if (this.killFeed.length > 25) this.killFeed.shift();
  }

  #trimKillFeed(now) {
    this.killFeed = this.killFeed.filter((k) => now - k.createdAt <= 5000);
  }

  #setSpectateTarget(deadId, preferredId = null) {
    const p = this.players.find((x) => x.id === deadId);
    if (!p) return;
    if (preferredId) {
      const target = this.snakes.get(preferredId);
      if (target && target.alive) {
        p.spectatingId = preferredId;
        return;
      }
    }
    const alive = [...this.snakes.values()].find((s) => s.alive);
    p.spectatingId = alive ? alive.id : null;
  }

  setInput(playerId, dir) {
    if (!DIRS[dir]) return;
    const snake = this.snakes.get(playerId);
    if (!snake || !snake.alive) return;
    if (OPPOSITE[snake.dir] === dir) return;
    snake.nextDir = dir;
  }

  spectateNext(playerId) {
    const viewer = this.players.find((p) => p.id === playerId);
    if (!viewer) return;
    const alive = [...this.snakes.values()].filter((s) => s.alive);
    if (alive.length === 0) {
      viewer.spectatingId = null;
      return;
    }
    const currentIdx = alive.findIndex((s) => s.id === viewer.spectatingId);
    viewer.spectatingId = alive[(currentIdx + 1 + alive.length) % alive.length].id;
  }

  eliminatePlayer(playerId, reason = 'disconnected') {
    const snake = this.snakes.get(playerId);
    if (!snake || !snake.alive) return;
    const rank = this.#aliveCount();
    snake.alive = false;
    snake.deathTick = this.tick;
    snake.rank = rank;

    for (const part of snake.segments) {
      this.fruits.push({
        id: `corpse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: 'corpse',
        emoji: '💜',
        growth: 1,
        color: '#c084fc',
        x: part.x,
        y: part.y,
        expiresAt: Date.now() + MAP_CONFIG.corpseFruitTtlMs,
      });
    }

    const msg = reason === 'disconnected'
      ? `📴 ${snake.name} rời trận`
      : `💀 ${snake.name} bị loại`;
    this.#addKillFeed(msg, [snake.id]);
  }

  addSpectator(playerId) {
    /* Add a spectator who never had a snake — just receives state broadcasts */
    if (this.players.find((p) => p.id === playerId)) return; /* already exists */
    const alive = [...this.snakes.values()].find((s) => s.alive);
    this.players.push({
      id: playerId,
      name: `Spectator${playerId}`,
      colorIndex: 0,
      skinIndex: 0,
      spectatingId: alive ? alive.id : null,
      stats: { kills: 0, fruitsEaten: 0, maxLength: 0 },
    });
    /* Create a dead snake entry so getStateFor can resolve camera */
    this.snakes.set(playerId, {
      id: playerId,
      name: `Spectator${playerId}`,
      colorIndex: 0,
      skinIndex: 0,
      segments: [{ x: Math.floor(MAP_CONFIG.width / 2), y: Math.floor(MAP_CONFIG.height / 2) }],
      dir: 'right',
      nextDir: 'right',
      alive: false,
      deathTick: 0,
      rank: null,
    });
  }

  step(now = Date.now()) {
    this.#flushExpiredCorpseFruits(now);
    this.#flushFruitRespawns(now);
    this.#trimKillFeed(now);

    if (this.phase === 'countdown') {
      if (now >= this.matchStartAt) {
        this.phase = 'running';
        this.#addKillFeed('GO! Trận đấu bắt đầu');
      }
      return;
    }

    if (this.phase !== 'running') return;

    this.tick += 1;
    const aliveSnakes = [...this.snakes.values()].filter((s) => s.alive);

    const nextHeads = new Map();
    for (const s of aliveSnakes) {
      if (OPPOSITE[s.dir] !== s.nextDir) s.dir = s.nextDir;
      const v = DIRS[s.dir];
      nextHeads.set(s.id, { x: s.segments[0].x + v.x, y: s.segments[0].y + v.y });
    }

    const fruitMap = new Map();
    for (let i = 0; i < this.fruits.length; i++) {
      fruitMap.set(keyOf(this.fruits[i].x, this.fruits[i].y), i);
    }

    const growthBySnake = new Map();
    const eatenFruitIndexes = new Set();
    for (const s of aliveSnakes) {
      const h = nextHeads.get(s.id);
      const idx = fruitMap.get(keyOf(h.x, h.y));
      if (idx === undefined) {
        growthBySnake.set(s.id, 0);
        continue;
      }
      const fruit = this.fruits[idx];
      growthBySnake.set(s.id, fruit.growth || 0);
      eatenFruitIndexes.add(idx);
      if (fruit.kind !== 'corpse') this.#scheduleFruitRespawn(fruit.kind);
      const player = this.players.find((p) => p.id === s.id);
      if (player) {
        player.stats.fruitsEaten += 1;
      }
    }

    if (eatenFruitIndexes.size > 0) {
      this.fruits = this.fruits.filter((_, idx) => !eatenFruitIndexes.has(idx));
    }

    const projected = new Map();
    for (const s of aliveSnakes) {
      const growth = growthBySnake.get(s.id) || 0;
      const head = nextHeads.get(s.id);
      const body = [head, ...s.segments];
      const keep = s.segments.length + growth;
      projected.set(s.id, body.slice(0, keep));
    }

    const dead = new Map();
    const killerByVictim = new Map();

    for (const s of aliveSnakes) {
      const head = nextHeads.get(s.id);
      if (head.x < 0 || head.y < 0 || head.x >= MAP_CONFIG.width || head.y >= MAP_CONFIG.height) {
        dead.set(s.id, 'wall');
      }
    }

    for (const s of aliveSnakes) {
      if (dead.has(s.id)) continue;
      const segs = projected.get(s.id);
      const head = segs[0];
      if (segs.slice(1).some((part) => part.x === head.x && part.y === head.y)) {
        dead.set(s.id, 'self');
      }
    }

    const headsByCell = new Map();
    for (const s of aliveSnakes) {
      if (dead.has(s.id)) continue;
      const h = nextHeads.get(s.id);
      const k = keyOf(h.x, h.y);
      if (!headsByCell.has(k)) headsByCell.set(k, []);
      headsByCell.get(k).push(s.id);
    }

    for (const ids of headsByCell.values()) {
      if (ids.length <= 1) continue;
      for (const id of ids) dead.set(id, 'head_to_head');
    }

    for (const s of aliveSnakes) {
      if (dead.has(s.id)) continue;
      const head = nextHeads.get(s.id);
      for (const other of aliveSnakes) {
        if (s.id === other.id) continue;
        const otherBody = projected.get(other.id).slice(1);
        const hit = otherBody.some((part) => part.x === head.x && part.y === head.y);
        if (hit) {
          dead.set(s.id, 'hit_body');
          killerByVictim.set(s.id, other.id);
          break;
        }
      }
    }

    const deadThisTick = [];
    for (const s of aliveSnakes) {
      const player = this.players.find((p) => p.id === s.id);
      if (!dead.has(s.id)) {
        s.segments = projected.get(s.id);
        if (player) {
          player.stats.maxLength = Math.max(player.stats.maxLength, s.segments.length);
        }
        continue;
      }

      s.alive = false;
      s.deathTick = this.tick;
      const corpse = projected.get(s.id);
      for (const part of corpse) {
        this.fruits.push({
          id: `corpse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          kind: 'corpse',
          emoji: '💜',
          growth: 1,
          color: '#c084fc',
          x: part.x,
          y: part.y,
          expiresAt: Date.now() + MAP_CONFIG.corpseFruitTtlMs,
        });
      }

      const killerId = killerByVictim.get(s.id);
      if (killerId && killerId !== s.id) {
        const killerPlayer = this.players.find((p) => p.id === killerId);
        if (killerPlayer) killerPlayer.stats.kills += 1;
      }
      this.#setSpectateTarget(s.id, killerId || null);
      deadThisTick.push({ id: s.id, length: corpse.length });
    }

    if (deadThisTick.length > 0) {
      deadThisTick.sort((a, b) => b.length - a.length);
      const aliveAfter = this.#aliveCount();
      for (let i = 0; i < deadThisTick.length; i++) {
        const snake = this.snakes.get(deadThisTick[i].id);
        if (!snake) continue;
        snake.rank = aliveAfter + deadThisTick.length - i;
      }

      for (const d of deadThisTick) {
        const snake = this.snakes.get(d.id);
        const killerId = killerByVictim.get(d.id);
        if (killerId) {
          const killer = this.snakes.get(killerId);
          this.#addKillFeed(`🐍 ${killer.name} hạ gục 🐍 ${snake.name}`, [killerId, d.id]);
        } else {
          const reason = dead.get(d.id);
          if (reason === 'self') this.#addKillFeed(`🐍 ${snake.name} tự cắn mình`, [d.id]);
          else if (reason === 'wall') this.#addKillFeed(`🐍 ${snake.name} chạm tường`, [d.id]);
          else this.#addKillFeed(`💥 ${snake.name} va chạm trực diện`, [d.id]);
        }
      }
    }

    const aliveNow = this.#aliveCount();
    if (aliveNow > 3) this.lastAliveAnnouncement = null;
    if (aliveNow <= 3 && aliveNow > 0 && this.lastAliveAnnouncement !== aliveNow) {
      this.#addKillFeed(`⚠️ Còn ${aliveNow} rắn sống sót!`);
      this.lastAliveAnnouncement = aliveNow;
    }

    if (aliveNow <= 1) {
      this.phase = 'ended';
      this.endedAt = now;
      const winner = [...this.snakes.values()].find((s) => s.alive);
      if (winner) {
        winner.rank = 1;
        this.#addKillFeed(`🏆 ${winner.name} là người cuối cùng!`, [winner.id]);
      }

      const withoutRank = [...this.snakes.values()].filter((s) => s.rank == null);
      withoutRank.sort((a, b) => b.segments.length - a.segments.length);
      for (let i = 0; i < withoutRank.length; i++) {
        withoutRank[i].rank = 1 + i;
      }
    }
  }

  getStateFor(playerId) {
    const player = this.players.find((p) => p.id === playerId);
    const youSnake = this.snakes.get(playerId);
    const targetSnake = this.#resolveCameraTarget(playerId);
    const center = targetSnake
      ? targetSnake.segments[0]
      : { x: Math.floor(MAP_CONFIG.width / 2), y: Math.floor(MAP_CONFIG.height / 2) };

    const half = Math.floor(MAP_CONFIG.viewportCells / 2);
    const minX = center.x - half - MAP_CONFIG.viewportBufferCells;
    const maxX = center.x + half + MAP_CONFIG.viewportBufferCells;
    const minY = center.y - half - MAP_CONFIG.viewportBufferCells;
    const maxY = center.y + half + MAP_CONFIG.viewportBufferCells;

    const visibleSnakes = [...this.snakes.values()]
      .filter((s) => s.segments.some((part) => part.x >= minX && part.x <= maxX && part.y >= minY && part.y <= maxY))
      .map((s) => ({
        id: s.id,
        name: s.name,
        colorIndex: s.colorIndex,
        skinIndex: s.skinIndex,
        alive: s.alive,
        segments: s.segments,
      }));

    const visibleFruits = this.fruits
      .filter((f) => f.x >= minX && f.x <= maxX && f.y >= minY && f.y <= maxY)
      .map((f) => ({
        x: f.x,
        y: f.y,
        kind: f.kind,
        emoji: f.emoji,
        color: f.color,
      }));

    const aliveCount = this.#aliveCount();
    const topFeed = this.killFeed.slice(-4);
    const proximity = [];
    if (targetSnake && targetSnake.alive) {
      const myHead = targetSnake.segments[0];
      const radius = MAP_CONFIG.detectionRadiusCells;
      for (const s of this.snakes.values()) {
        if (!s.alive || s.id === targetSnake.id) continue;
        const other = s.segments[0];
        const dx = other.x - myHead.x;
        const dy = other.y - myHead.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= radius) {
          proximity.push({
            id: s.id,
            name: s.name,
            colorIndex: s.colorIndex,
            dx,
            dy,
            distance: Math.round(dist),
          });
        }
      }
      proximity.sort((a, b) => a.distance - b.distance);
    }

    return {
      type: 'state',
      tick: this.tick,
      phase: this.phase,
      countdownMsLeft: Math.max(0, this.matchStartAt - Date.now()),
      alive: aliveCount,
      totalPlayers: this.players.length,
      map: {
        width: MAP_CONFIG.width,
        height: MAP_CONFIG.height,
        cellSize: MAP_CONFIG.cellSize,
        viewportCells: MAP_CONFIG.viewportCells,
      },
      you: {
        id: playerId,
        alive: !!youSnake?.alive,
        length: youSnake ? youSnake.segments.length : 0,
        kills: player ? player.stats.kills : 0,
        fruitsEaten: player ? player.stats.fruitsEaten : 0,
        maxLength: player ? player.stats.maxLength : 0,
        rank: youSnake?.rank || null,
      },
      spectate: {
        targetId: player ? player.spectatingId : null,
      },
      camera: center,
      snakes: visibleSnakes,
      fruits: visibleFruits,
      minimapSnakes: [...this.snakes.values()].map((s) => ({
        id: s.id,
        x: s.segments[0].x,
        y: s.segments[0].y,
        alive: s.alive,
        colorIndex: s.colorIndex,
        skinIndex: s.skinIndex,
      })),
      proximity,
      colors: SNAKE_COLORS,
      killFeed: topFeed,
    };
  }

  getResults() {
    const standings = this.players
      .map((p) => {
        const snake = this.snakes.get(p.id);
        return {
          id: p.id,
          name: p.name,
          colorIndex: snake ? snake.colorIndex : 0,
          rank: snake?.rank || this.players.length,
          kills: p.stats.kills,
          fruitsEaten: p.stats.fruitsEaten,
          maxLength: p.stats.maxLength,
          alive: !!snake?.alive,
        };
      })
      .sort((a, b) => a.rank - b.rank || b.kills - a.kills || b.maxLength - a.maxLength);

    return {
      type: 'match_end',
      standings,
      durationMs: (this.endedAt || Date.now()) - this.matchStartAt,
    };
  }

  #resolveCameraTarget(playerId) {
    const you = this.snakes.get(playerId);
    if (you && you.alive) return you;
    const player = this.players.find((p) => p.id === playerId);
    if (!player) return null;
    if (player.spectatingId) {
      const target = this.snakes.get(player.spectatingId);
      if (target && target.alive) return target;
    }
    const alive = [...this.snakes.values()].find((s) => s.alive);
    if (alive) {
      player.spectatingId = alive.id;
      return alive;
    }
    return null;
  }
}

module.exports = {
  SnakeEngine,
  DIRS,
};
