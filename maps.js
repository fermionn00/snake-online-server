'use strict';

const MAP_CONFIG = {
  width: 2000,
  height: 2000,
  cellSize: 10,
  viewportCells: 60,
  viewportBufferCells: 10,
  detectionRadiusCells: 85,
  tickMs: 100,
  minPlayersToStart: 2,
  maxPlayers: 10,
  queueTimeoutMs: 60000,
  initialSnakeLength: 3,
  corpseFruitTtlMs: 30000,
};

const SPAWN_POINTS = [
  { x: 400, y: 200, dir: 'right' },
  { x: 1000, y: 200, dir: 'down' },
  { x: 1600, y: 200, dir: 'left' },
  { x: 1800, y: 700, dir: 'left' },
  { x: 1800, y: 1300, dir: 'left' },
  { x: 1600, y: 1800, dir: 'left' },
  { x: 1000, y: 1800, dir: 'up' },
  { x: 400, y: 1800, dir: 'right' },
  { x: 200, y: 1300, dir: 'right' },
  { x: 200, y: 700, dir: 'right' },
];

const SNAKE_COLORS = [
  { name: 'Xanh Lá', headA: '#4ade80', headB: '#22d3ee', bodyA: [74, 222, 128], bodyB: [34, 211, 238], glow: '#22d3ee' },
  { name: 'Đỏ', headA: '#f87171', headB: '#dc2626', bodyA: [248, 113, 113], bodyB: [220, 38, 38], glow: '#ef4444' },
  { name: 'Tím', headA: '#a78bfa', headB: '#7c3aed', bodyA: [167, 139, 250], bodyB: [124, 58, 237], glow: '#a855f7' },
  { name: 'Cam', headA: '#fb923c', headB: '#ea580c', bodyA: [251, 146, 60], bodyB: [234, 88, 12], glow: '#f97316' },
  { name: 'Vàng', headA: '#fbbf24', headB: '#d97706', bodyA: [251, 191, 36], bodyB: [217, 119, 6], glow: '#f59e0b' },
  { name: 'Hồng', headA: '#f472b6', headB: '#db2777', bodyA: [244, 114, 182], bodyB: [219, 39, 119], glow: '#ec4899' },
  { name: 'Xanh Dương', headA: '#60a5fa', headB: '#2563eb', bodyA: [96, 165, 250], bodyB: [37, 99, 235], glow: '#3b82f6' },
  { name: 'Trắng', headA: '#e2e8f0', headB: '#94a3b8', bodyA: [226, 232, 240], bodyB: [148, 163, 184], glow: '#cbd5e1' },
  { name: 'Ngọc', headA: '#2dd4bf', headB: '#0d9488', bodyA: [45, 212, 191], bodyB: [13, 148, 136], glow: '#14b8a6' },
  { name: 'Nâu Đỏ', headA: '#f97316', headB: '#9a3412', bodyA: [249, 115, 22], bodyB: [154, 52, 18], glow: '#ea580c' },
];

const FRUIT_CONFIG = [
  { kind: 'apple', emoji: '🍎', growth: 1, target: 2400, color: '#f87171', respawnMinMs: 3000, respawnMaxMs: 5000 },
  { kind: 'grape', emoji: '🍇', growth: 2, target: 1000, color: '#a78bfa', respawnMinMs: 3000, respawnMaxMs: 5000 },
  { kind: 'star', emoji: '⭐', growth: 3, target: 420, color: '#fbbf24', respawnMinMs: 3000, respawnMaxMs: 5000 },
  { kind: 'diamond', emoji: '💎', growth: 5, target: 180, color: '#60a5fa', respawnMinMs: 3000, respawnMaxMs: 5000 },
  { kind: 'corpse', emoji: '💜', growth: 1, target: 0, color: '#c084fc', respawnMinMs: 0, respawnMaxMs: 0 },
];

module.exports = {
  MAP_CONFIG,
  SPAWN_POINTS,
  SNAKE_COLORS,
  FRUIT_CONFIG,
};
