/**
 * packets.js — Hazard Packet Types + Object Pool + Spawning
 *
 * Three types introduced progressively per spec:
 *   'drifter' — straight-line, available from t=0        (magenta)
 *   'seeker'  — homing, limited turn rate, intro ~15s    (orange)
 *   'pulse'   — stationary telegraph + expand, intro ~30s (red)
 *
 * All packets are pooled — no allocations inside the game loop.
 * Collision detection and near-miss tracking happen here.
 */

import { params, difficultyConfig, recordNearMiss } from './difficulty.js';
import { player, PLAYER_RADIUS } from './player.js';
import { emitBurst } from './particles.js';
import { playNearMiss } from './audio.js';

// ── Pool configuration ─────────────────────────────────────────────────────
const POOL_SIZE = 120;
const PACKET_RADIUS = 7;

// ── Packet prototype object ────────────────────────────────────────────────
function createPacket() {
  return {
    alive: false,
    type: 'drifter',   // 'drifter' | 'seeker' | 'pulse'
    x: 0, y: 0,
    vx: 0, vy: 0,
    radius: PACKET_RADIUS,

    // Seeker-specific
    angle: 0,           // current heading (radians)

    // Pulse-specific
    pulsePhase: 'telegraph', // 'telegraph' | 'active' | 'cooldown'
    pulseTimer: 0,           // ms elapsed in current phase
    pulseRadius: 0,          // current expanded radius (drawn separately)
    pulseMaxRadius: 55,      // max expanded radius at full danger

    // Near-miss tracking
    _nearMissed: false,      // has this packet already granted a near-miss?
  };
}

const _pool = Array.from({ length: POOL_SIZE }, createPacket);
let _active = [];

// Spawn timing
let _spawnTimer = 0;   // ms until next spawn
let _pulseTimer = 0;   // ms until next pulse spawn (separate interval)

// ── Public API ─────────────────────────────────────────────────────────────

/** Reset pool + timers for a fresh run. */
export function resetPackets() {
  for (const p of _pool) p.alive = false;
  _active = [];
  _spawnTimer = 500; // brief delay before first packet
  _pulseTimer = difficultyConfig.PULSE_INTRO_TIME; // starts at intro time
}

/** Returns active packets array (for renderer). */
export function getActivePackets() {
  return _active;
}

/**
 * Main update tick — spawning, movement, and near-miss detection.
 * Collision detection (returning true on hit) is done separately in main.js.
 * @param {number} dt          — delta time in ms
 * @param {number} survivalMs  — total run time for intro gating
 * @param {number} canvasW, canvasH
 * @returns {boolean} true if the player was hit this frame
 */
export function updatePackets(dt, survivalMs, canvasW, canvasH) {
  // ── Spawn ──────────────────────────────────────────────────────────────
  _spawnTimer -= dt;
  if (_spawnTimer <= 0) {
    _spawnTimer = params.spawnInterval;
    _spawnPacket(survivalMs, canvasW, canvasH, false);
  }

  // Pulse spawning has its own separate cooldown
  if (survivalMs > difficultyConfig.PULSE_INTRO_TIME) {
    _pulseTimer -= dt;
    if (_pulseTimer <= 0) {
      _pulseTimer = params.pulseCooldown;
      _spawnPacket(survivalMs, canvasW, canvasH, true);
    }
  }

  // ── Update each active packet ─────────────────────────────────────────
  let playerHit = false;

  for (let i = _active.length - 1; i >= 0; i--) {
    const p = _active[i];

    if (p.type === 'drifter') _updateDrifter(p, dt, canvasW, canvasH);
    else if (p.type === 'seeker') _updateSeeker(p, dt, canvasW, canvasH);
    else if (p.type === 'pulse') _updatePulse(p, dt);

    if (!p.alive) {
      _active.splice(i, 1);
      continue;
    }

    // ── Collision & near-miss ───────────────────────────────────────────
    if (!player.isInvincible) {
      if (p.type === 'pulse') {
        // Pulse only hurts during active phase
        if (p.pulsePhase === 'active') {
          const dx = player.x - p.x;
          const dy = player.y - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < p.pulseRadius + PLAYER_RADIUS * 0.5) {
            playerHit = true;
          }
        }
      } else {
        const dx = player.x - p.x;
        const dy = player.y - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const hitDist   = p.radius + PLAYER_RADIUS * 0.85; // slightly forgiving
        const missDist  = p.radius + PLAYER_RADIUS * difficultyConfig.NEAR_MISS_RADIUS_MULTIPLIER;

        if (dist < hitDist) {
          playerHit = true;
        } else if (dist < missDist && !p._nearMissed) {
          // Near-miss! Only count once per packet per pass-by
          p._nearMissed = true;
          recordNearMiss();
          player.nearMissCount++;
          playNearMiss();
          // Spark burst at midpoint between player and packet
          const mx = (player.x + p.x) / 2;
          const my = (player.y + p.y) / 2;
          emitBurst(mx, my, 6, '#fff0a0', { speed: 80, lifeMs: 300, radius: 2 });
        }
      }
    }
  }

  return playerHit;
}

// ── Internal helpers ───────────────────────────────────────────────────────

function _acquire() {
  for (let i = 0; i < _pool.length; i++) {
    if (!_pool[i].alive) return _pool[i];
  }
  return null;
}

/** Spawn a packet from a random canvas edge. */
function _spawnPacket(survivalMs, canvasW, canvasH, forcePulse) {
  const p = _acquire();
  if (!p) return;

  // Decide type
  let type;
  if (forcePulse) {
    type = 'pulse';
  } else {
    const rand = Math.random();
    const seekerCap = survivalMs > difficultyConfig.SEEKER_INTRO_TIME ? params.seekerProportion : 0;
    if (rand < seekerCap) type = 'seeker';
    else type = 'drifter';
  }

  p.alive        = true;
  p.type         = type;
  p._nearMissed  = false;

  if (type === 'pulse') {
    // Pulse spawns at a random interior position (not too close to player or edge)
    const margin = 80;
    p.x = margin + Math.random() * (canvasW - margin * 2);
    p.y = margin + Math.random() * (canvasH - margin * 2);
    // Ensure not spawned on top of the player
    const dx = p.x - player.x;
    const dy = p.y - player.y;
    if (Math.sqrt(dx * dx + dy * dy) < 120) {
      p.x += (dx / (Math.sqrt(dx * dx + dy * dy) || 1)) * 120;
      p.y += (dy / (Math.sqrt(dx * dx + dy * dy) || 1)) * 120;
    }
    p.pulsePhase  = 'telegraph';
    p.pulseTimer  = 0;
    p.pulseRadius = 0;
    p.radius      = PACKET_RADIUS;
    p.vx = 0; p.vy = 0;
  } else {
    // Spawn on a random edge
    const edge = Math.floor(Math.random() * 4);
    if (edge === 0) { p.x = Math.random() * canvasW; p.y = -20; }
    else if (edge === 1) { p.x = canvasW + 20; p.y = Math.random() * canvasH; }
    else if (edge === 2) { p.x = Math.random() * canvasW; p.y = canvasH + 20; }
    else { p.x = -20; p.y = Math.random() * canvasH; }

    p.radius = PACKET_RADIUS;

    if (type === 'drifter') {
      const spd = params.drifterSpeedMin + Math.random() * (params.drifterSpeedMax - params.drifterSpeedMin);
      // Aim roughly toward canvas center with some spread
      const targetX = canvasW * 0.2 + Math.random() * canvasW * 0.6;
      const targetY = canvasH * 0.2 + Math.random() * canvasH * 0.6;
      const dx = targetX - p.x;
      const dy = targetY - p.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      p.vx = (dx / len) * spd;
      p.vy = (dy / len) * spd;
      p.angle = Math.atan2(p.vy, p.vx);
    } else if (type === 'seeker') {
      // Start heading toward player
      const dx = player.x - p.x;
      const dy = player.y - p.y;
      p.angle = Math.atan2(dy, dx);
      p.vx = Math.cos(p.angle) * params.seekerSpeed;
      p.vy = Math.sin(p.angle) * params.seekerSpeed;
    }
  }

  _active.push(p);
}

function _updateDrifter(p, dt, canvasW, canvasH) {
  const dtSec = dt / 1000;
  p.x += p.vx * dtSec;
  p.y += p.vy * dtSec;

  // Despawn when well off-screen
  const margin = 80;
  if (p.x < -margin || p.x > canvasW + margin ||
      p.y < -margin || p.y > canvasH + margin) {
    p.alive = false;
  }
}

function _updateSeeker(p, dt, canvasW, canvasH) {
  const dtSec = dt / 1000;

  // Steer toward player with limited turn rate (not perfect tracking)
  const dx = player.x - p.x;
  const dy = player.y - p.y;
  const targetAngle = Math.atan2(dy, dx);
  let angleDiff = targetAngle - p.angle;

  // Normalize to -π..π
  while (angleDiff >  Math.PI) angleDiff -= Math.PI * 2;
  while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

  const maxTurn = params.seekerTurnRate * dtSec;
  p.angle += Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), maxTurn);

  p.vx = Math.cos(p.angle) * params.seekerSpeed;
  p.vy = Math.sin(p.angle) * params.seekerSpeed;
  p.x += p.vx * dtSec;
  p.y += p.vy * dtSec;

  // Seekers despawn once they've gone far off-screen (they'll curve back, but
  // if they somehow exit the arena after ~10s, remove them)
  const margin = 120;
  if (p.x < -margin || p.x > canvasW + margin ||
      p.y < -margin || p.y > canvasH + margin) {
    p.alive = false;
  }
}

const PULSE_MAX_RADIUS = 60; // px

function _updatePulse(p, dt) {
  p.pulseTimer += dt;

  if (p.pulsePhase === 'telegraph') {
    if (p.pulseTimer >= difficultyConfig.PULSE_TELEGRAPH_MS) {
      p.pulsePhase = 'active';
      p.pulseTimer = 0;
    }
    // No movement during telegraph
    p.pulseRadius = 0;
  } else if (p.pulsePhase === 'active') {
    // Expand rapidly to max, then the phase ends
    const progress = Math.min(p.pulseTimer / difficultyConfig.PULSE_ACTIVE_MS, 1);
    // Use a bell curve: expand then contract
    const bell = Math.sin(progress * Math.PI);
    p.pulseRadius = bell * PULSE_MAX_RADIUS;
    if (p.pulseTimer >= difficultyConfig.PULSE_ACTIVE_MS) {
      p.pulsePhase = 'cooldown';
      p.pulseTimer = 0;
      p.pulseRadius = 0;
    }
  } else if (p.pulsePhase === 'cooldown') {
    // After cooldown, pulse is done — despawn it
    // (a fresh one will spawn via the pulse timer in updatePackets)
    if (p.pulseTimer >= 1200) {
      p.alive = false;
    }
  }
}
