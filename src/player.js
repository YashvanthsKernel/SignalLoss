/**
 * player.js — Player Entity
 *
 * Manages position, velocity, dash state, trail, and cooldown indicator.
 * Does NOT draw itself — all rendering is in render.js.
 */

import { params } from './difficulty.js';
import { recordDash } from './difficulty.js';
import { emitBurst } from './particles.js';
import { playDash } from './audio.js';

export const PLAYER_RADIUS = 10;

// Movement speed (px/s) — base speed and dash speed
const BASE_SPEED  = 220;
const DASH_SPEED  = 580;
const DASH_DURATION_MS    = 150;  // how long the speed burst lasts
const DASH_INVINCIBLE_MS  = 150;  // invincibility window during dash
const DASH_COOLDOWN_MS    = 2000; // time between dashes

// Trail: store last N positions
const TRAIL_LENGTH = 10;

export const player = {
  x: 0, y: 0,
  vx: 0, vy: 0,
  radius: PLAYER_RADIUS,

  // Dash state
  isDashing: false,
  dashTimer: 0,       // ms remaining in dash burst
  dashCooldown: 0,    // ms remaining on cooldown
  isInvincible: false,
  invincibleTimer: 0,

  // Trail: circular buffer of { x, y }
  trail: Array.from({ length: TRAIL_LENGTH }, () => ({ x: 0, y: 0 })),
  trailIndex: 0,

  // Score-relevant
  nearMissCount: 0,
};

/** Place the player at the center of the canvas at run start. */
export function resetPlayer(canvasW, canvasH) {
  player.x = canvasW / 2;
  player.y = canvasH / 2;
  player.vx = 0;
  player.vy = 0;
  player.isDashing = false;
  player.dashTimer = 0;
  player.dashCooldown = 0;
  player.isInvincible = false;
  player.invincibleTimer = 0;
  player.nearMissCount = 0;

  // Initialize trail to spawn position
  for (const t of player.trail) {
    t.x = player.x;
    t.y = player.y;
  }
  player.trailIndex = 0;
}

/**
 * Update player position and state.
 * @param {number} dt         — delta time in ms
 * @param {object} intent     — { vx, vy, dashPressed } from input.js
 * @param {number} canvasW, canvasH — for boundary clamping
 */
export function updatePlayer(dt, intent, canvasW, canvasH) {
  const dtSec = dt / 1000;

  // ── Dash trigger ────────────────────────────────────────────────────────
  if (intent.dashPressed && player.dashCooldown <= 0 && !player.isDashing) {
    player.isDashing = true;
    player.dashTimer = DASH_DURATION_MS;
    player.isInvincible = true;
    player.invincibleTimer = DASH_INVINCIBLE_MS;
    player.dashCooldown = DASH_COOLDOWN_MS;

    recordDash();
    playDash();

    // Emit dash particles in opposite direction of travel (feel of propulsion)
    const angle = Math.atan2(intent.vy, intent.vx);
    emitBurst(player.x, player.y, 14, '#00f7ff', {
      speed: 180,
      lifeMs: 320,
      radius: 2.5,
      angleOffset: angle + Math.PI, // burst backward
      spread: Math.PI * 0.7,
      glow: true,
    });
  }

  // ── Tick timers ─────────────────────────────────────────────────────────
  if (player.isDashing) {
    player.dashTimer -= dt;
    if (player.dashTimer <= 0) {
      player.isDashing = false;
      player.dashTimer = 0;
    }
  }

  if (player.isInvincible) {
    player.invincibleTimer -= dt;
    if (player.invincibleTimer <= 0) {
      player.isInvincible = false;
      player.invincibleTimer = 0;
    }
  }

  if (player.dashCooldown > 0) {
    player.dashCooldown -= dt;
    if (player.dashCooldown < 0) player.dashCooldown = 0;
  }

  // ── Movement ─────────────────────────────────────────────────────────────
  const speed = player.isDashing ? DASH_SPEED : BASE_SPEED;

  // Lerp velocity toward intent for slight easing (better game feel)
  // Lerp factor 0.28 per ms → about 0.28^(1/16) ≈ smooth at 60fps
  // We use dt-normalized lerp to be frame-rate independent
  const lerpT = 1 - Math.pow(0.01, dtSec); // approaches intent exponentially
  player.vx = player.vx + (intent.vx * speed - player.vx) * lerpT;
  player.vy = player.vy + (intent.vy * speed - player.vy) * lerpT;

  // Push a trail point before moving
  player.trail[player.trailIndex] = { x: player.x, y: player.y };
  player.trailIndex = (player.trailIndex + 1) % TRAIL_LENGTH;

  // Integrate position
  player.x += player.vx * dtSec;
  player.y += player.vy * dtSec;

  // ── Boundary clamping (hard walls — wrap would allow "camping the edge") ─
  const r = player.radius;
  player.x = Math.max(r, Math.min(canvasW - r, player.x));
  player.y = Math.max(r, Math.min(canvasH - r, player.y));
}

/**
 * Returns trail points in order from oldest to newest.
 * Renderer uses this to draw the fading trail.
 */
export function getTrailPoints() {
  const result = [];
  for (let i = 0; i < TRAIL_LENGTH; i++) {
    const idx = (player.trailIndex + i) % TRAIL_LENGTH;
    result.push(player.trail[idx]);
  }
  return result;
}

/** Dash cooldown as 0..1 fraction (0 = on cooldown, 1 = ready). */
export function getDashCooldownFraction() {
  return 1 - (player.dashCooldown / DASH_COOLDOWN_MS);
}
