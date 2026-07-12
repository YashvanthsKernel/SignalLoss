/**
 * particles.js — Object-Pooled Particle System
 *
 * Particles are pooled (never "new" inside the game loop) to avoid GC stutter.
 * Types:
 *   'dash'     — cyan burst when player dashes
 *   'nearmiss' — soft white/gold chime sparks
 *   'death'    — red/orange explosion burst on collision
 *   'trail'    — player movement trail (handled separately in player.js, but
 *                this pool is also used for any extra spark trails)
 */

const POOL_SIZE = 300;

// Pre-allocate the entire pool at module load time
const _pool = Array.from({ length: POOL_SIZE }, () => createParticle());
let _active = []; // currently live particles

function createParticle() {
  return {
    alive: false,
    x: 0, y: 0,
    vx: 0, vy: 0,
    life: 0,      // remaining life (0..1, decreases each frame)
    decay: 0,     // how fast life drains (per ms)
    radius: 0,
    color: '#ffffff',
    alpha: 1,
    glow: false,
  };
}

/** Grab a dead particle from the pool. Returns null if pool is exhausted. */
function acquire() {
  for (let i = 0; i < _pool.length; i++) {
    if (!_pool[i].alive) return _pool[i];
  }
  return null; // pool exhausted — skip this spawn rather than allocate
}

// ── Public API ─────────────────────────────────────────────────────────────

/** Reset all active particles (call on new run). */
export function resetParticles() {
  for (const p of _pool) p.alive = false;
  _active = [];
}

/**
 * Emit a burst of particles.
 * @param {number} x, y      — origin
 * @param {number} count     — how many to emit
 * @param {string} color     — base color
 * @param {object} opts      — overrides (speed, lifeMs, radius, spread, glow)
 */
export function emitBurst(x, y, count, color, opts = {}) {
  const speed    = opts.speed    ?? 120;
  const lifeMs   = opts.lifeMs   ?? 500;
  const radius   = opts.radius   ?? 3;
  const spread   = opts.spread   ?? Math.PI * 2; // full circle by default
  const angleOff = opts.angleOffset ?? 0;
  const glow     = opts.glow     ?? false;

  for (let i = 0; i < count; i++) {
    const p = acquire();
    if (!p) break;
    const angle = angleOff + (i / count) * spread + (Math.random() - 0.5) * 0.6;
    const spd   = speed * (0.5 + Math.random() * 0.8);
    p.alive  = true;
    p.x      = x + (Math.random() - 0.5) * 4;
    p.y      = y + (Math.random() - 0.5) * 4;
    p.vx     = Math.cos(angle) * spd;
    p.vy     = Math.sin(angle) * spd;
    p.life   = 1;
    p.decay  = 1 / lifeMs;
    p.radius = radius * (0.6 + Math.random() * 0.8);
    p.color  = color;
    p.alpha  = 1;
    p.glow   = glow;
    _active.push(p);
  }
}

/**
 * Update all live particles.
 * @param {number} dt — delta time in milliseconds
 */
export function updateParticles(dt) {
  // Iterate backwards so splice is safe (we remove dead ones)
  for (let i = _active.length - 1; i >= 0; i--) {
    const p = _active[i];
    p.life -= p.decay * dt;
    if (p.life <= 0) {
      p.alive = false;
      _active.splice(i, 1);
      continue;
    }
    // Apply drag so particles decelerate naturally (feels more organic)
    const drag = 1 - 0.004 * dt;
    p.vx *= drag;
    p.vy *= drag;
    p.x  += p.vx * (dt / 1000);
    p.y  += p.vy * (dt / 1000);
    p.alpha = p.life; // fade out linearly
  }
}

/** Returns the array of active particles for the renderer. */
export function getActiveParticles() {
  return _active;
}
