/**
 * input.js — Unified Input Normalizer
 *
 * Reads keyboard + touch and exposes a single intent object per frame:
 *   { x, y, dashPressed, anyPressed }
 *
 * All other game code consumes only getIntent() — no direct key/touch checks
 * elsewhere. This keeps input "plumbing" isolated and trivially swappable.
 */

// ── Keyboard state ─────────────────────────────────────────────────────────
const keys = {};

window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
});

window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  // Dash is edge-triggered on keydown, not held — reset on keyup
  if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
    _dashQueued = false;
  }
});

// Track falling edges for "press Space to start" type transitions
let _dashQueued = false;
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
    e.preventDefault(); // prevent page scroll on spacebar
    _dashQueued = true;
  }
});

// ── Touch state ────────────────────────────────────────────────────────────
const touch = {
  active: false,
  x: 0,
  y: 0,
  tapQueued: false, // a quick tap that didn't result in a drag becomes a dash
};

let _touchStartTime = 0;
let _touchStartX = 0;
let _touchStartY = 0;
let _isDragging = false;

window.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const t = e.touches[0];
  touch.active = true;
  touch.x = t.clientX;
  touch.y = t.clientY;
  _touchStartTime = performance.now();
  _touchStartX = t.clientX;
  _touchStartY = t.clientY;
  _isDragging = false;
  // Queue a dash on any tap-start (either a quick tap OR start of drag)
  touch.tapQueued = true;
}, { passive: false });

window.addEventListener('touchmove', (e) => {
  e.preventDefault();
  const t = e.touches[0];
  touch.x = t.clientX;
  touch.y = t.clientY;
  _isDragging = true;
}, { passive: false });

window.addEventListener('touchend', (e) => {
  e.preventDefault();
  touch.active = false;
  touch.tapQueued = false;
  _isDragging = false;
}, { passive: false });

// ── Intent query ───────────────────────────────────────────────────────────
/**
 * Returns the current movement + action intent as a normalized object.
 * canvas: the game canvas element (needed to convert touch px → game coords).
 * playerX, playerY: current player position (touch moves player toward finger).
 */
export function getIntent(canvas, playerX, playerY) {
  let vx = 0;
  let vy = 0;
  let dashPressed = false;
  let anyPressed = false;

  // ── Keyboard ──
  if (keys['ArrowLeft']  || keys['KeyA']) { vx -= 1; anyPressed = true; }
  if (keys['ArrowRight'] || keys['KeyD']) { vx += 1; anyPressed = true; }
  if (keys['ArrowUp']    || keys['KeyW']) { vy -= 1; anyPressed = true; }
  if (keys['ArrowDown']  || keys['KeyS']) { vy += 1; anyPressed = true; }

  if (_dashQueued) {
    dashPressed = true;
    _dashQueued = false; // consume
  }

  // ── Touch ──
  if (touch.active) {
    anyPressed = true;
    // Convert finger position to a direction vector from player toward finger.
    // Lerp is handled in player.js; here we just report the raw target offset.
    const dx = touch.x - playerX;
    const dy = touch.y - playerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    // Only push if finger is more than ~15px away (dead zone prevents micro-jitter)
    if (dist > 15) {
      vx += dx / dist;
      vy += dy / dist;
    }

    if (touch.tapQueued) {
      dashPressed = true;
      touch.tapQueued = false; // consume
    }
  }

  // Normalize diagonal movement so diagonal speed == cardinal speed
  const len = Math.sqrt(vx * vx + vy * vy);
  if (len > 1) {
    vx /= len;
    vy /= len;
  }

  return { vx, vy, dashPressed, anyPressed };
}

/** Call this to read whether any "confirm/start" input is currently down. */
export function isStartPressed() {
  return keys['Space'] || keys['Enter'] || touch.tapQueued;
}

/** Consume the start-press (called after handling menu/gameover transitions). */
export function consumeStart() {
  keys['Space'] = false;
  keys['Enter'] = false;
  touch.tapQueued = false;
  _dashQueued = false;
}
