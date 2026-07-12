/**
 * render.js — All Canvas Drawing
 *
 * This module owns every draw call. Nothing else calls ctx.fillRect / etc.
 * Sections:
 *   - Background (grid + scanlines)
 *   - Packets (drifters, seekers, pulses with their telegraph rings)
 *   - Player (glow, trail, dash cooldown ring)
 *   - Particles
 *   - HUD (time, near-misses, dash indicator)
 *   - Menu + Game-over overlays
 *
 * Note: TELEGRAPH_MS is inlined here to avoid a circular import
 * (render → difficulty → packets → render). Must match PULSE_TELEGRAPH_MS in difficulty.js.
 */

import { getTrailPoints, getDashCooldownFraction, PLAYER_RADIUS } from './player.js';
import { getActiveParticles } from './particles.js';

// Inlined from difficulty.js to avoid circular deps — must match PULSE_TELEGRAPH_MS
const TELEGRAPH_MS = 1100;


// ── Colors ─────────────────────────────────────────────────────────────────
const C = {
  bg:         '#0a0e1a',
  grid:       'rgba(30, 50, 90, 0.35)',
  player:     '#e0f8ff',
  playerGlow: '#00c8ff',
  drifter:    '#e040fb',   // magenta
  seeker:     '#ff7b00',   // orange
  pulse:      '#ff2244',   // red
  dashReady:  '#00f7ff',
  dashEmpty:  'rgba(0,247,255,0.18)',
  nearMiss:   '#ffd166',
  hud:        'rgba(180,230,255,0.85)',
};

// Screen-shake state (managed externally via shakeScreen())
let _shakeX = 0;
let _shakeY = 0;
let _shakeMag = 0;
let _shakeDecay = 0.88; // multiplier per frame

export function shakeScreen(magnitude) {
  _shakeMag = Math.max(_shakeMag, magnitude);
}

function _tickShake() {
  _shakeX = (Math.random() - 0.5) * 2 * _shakeMag;
  _shakeY = (Math.random() - 0.5) * 2 * _shakeMag;
  _shakeMag *= _shakeDecay;
  if (_shakeMag < 0.3) { _shakeMag = 0; _shakeX = 0; _shakeY = 0; }
}

// ── Grid texture (drawn once to an offscreen canvas, reused every frame) ───
let _gridCanvas  = null;
let _gridCtx     = null;
let _gridW = 0, _gridH = 0;

function _buildGrid(w, h) {
  _gridCanvas = document.createElement('canvas');
  _gridCanvas.width  = w;
  _gridCanvas.height = h;
  _gridCtx = _gridCanvas.getContext('2d');

  _gridCtx.clearRect(0, 0, w, h);
  _gridCtx.strokeStyle = C.grid;
  _gridCtx.lineWidth   = 0.5;

  const step = 48;
  for (let x = 0; x <= w; x += step) {
    _gridCtx.beginPath();
    _gridCtx.moveTo(x, 0);
    _gridCtx.lineTo(x, h);
    _gridCtx.stroke();
  }
  for (let y = 0; y <= h; y += step) {
    _gridCtx.beginPath();
    _gridCtx.moveTo(0, y);
    _gridCtx.lineTo(w, y);
    _gridCtx.stroke();
  }
  _gridW = w; _gridH = h;
}

// ── Main render entry points ───────────────────────────────────────────────

export function renderGame(ctx, w, h, player, packets, survivalMs, normalizedDifficulty) {
  _tickShake();
  ctx.save();
  ctx.translate(_shakeX, _shakeY);

  _drawBackground(ctx, w, h);
  _drawPackets(ctx, packets);
  _drawTrail(ctx, player);
  _drawPlayer(ctx, player);
  _drawParticles(ctx);
  _drawHUD(ctx, w, h, player, survivalMs, normalizedDifficulty);

  ctx.restore();
}

export function renderMenu(ctx, w, h, bestScore) {
  _drawBackground(ctx, w, h);

  // Title
  ctx.save();
  ctx.textAlign = 'center';

  // Glowing title text
  const titleY = h * 0.38;
  ctx.font = `bold ${Math.min(w * 0.12, 72)}px 'Orbitron', monospace`;
  ctx.shadowColor   = C.playerGlow;
  ctx.shadowBlur    = 30;
  ctx.fillStyle     = '#ffffff';
  ctx.fillText('SIGNAL LOSS', w / 2, titleY);

  // Subtitle
  ctx.shadowBlur = 0;
  ctx.font       = `${Math.min(w * 0.035, 18)}px 'Share Tech Mono', monospace`;
  ctx.fillStyle  = 'rgba(0,200,255,0.75)';
  ctx.fillText('[ data corruption detected — survive as long as possible ]', w / 2, titleY + 44);

  // Controls hint
  ctx.fillStyle = 'rgba(160,210,240,0.7)';
  ctx.font      = `${Math.min(w * 0.028, 15)}px 'Share Tech Mono', monospace`;
  const controlsY = h * 0.55;
  ctx.fillText('WASD / ARROWS — move', w / 2, controlsY);
  ctx.fillText('SPACE / SHIFT — dash  (invincibility + speed burst)', w / 2, controlsY + 26);
  ctx.fillText('Survive near-misses for bonus score', w / 2, controlsY + 52);

  // Blinking start prompt
  const blink = Math.floor(Date.now() / 550) % 2 === 0;
  if (blink) {
    ctx.font      = `${Math.min(w * 0.038, 20)}px 'Orbitron', monospace`;
    ctx.fillStyle = C.dashReady;
    ctx.shadowColor = C.dashReady;
    ctx.shadowBlur  = 14;
    ctx.fillText('PRESS SPACE  /  TAP TO START', w / 2, h * 0.72);
  }

  // Best score
  if (bestScore > 0) {
    ctx.shadowBlur = 0;
    ctx.font       = `${Math.min(w * 0.026, 14)}px 'Share Tech Mono', monospace`;
    ctx.fillStyle  = 'rgba(255,209,102,0.7)';
    ctx.fillText(`SESSION BEST  ${_formatTime(bestScore)}`, w / 2, h * 0.82);
  }

  ctx.restore();
}

export function renderGameOver(ctx, w, h, player, survivalMs, bestScore) {
  // Dim the field
  ctx.fillStyle = 'rgba(5, 8, 20, 0.78)';
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.textAlign = 'center';

  // "CONNECTION LOST" header
  ctx.font       = `bold ${Math.min(w * 0.09, 56)}px 'Orbitron', monospace`;
  ctx.shadowColor = C.pulse;
  ctx.shadowBlur  = 28;
  ctx.fillStyle   = '#ff3355';
  ctx.fillText('CONNECTION LOST', w / 2, h * 0.36);

  ctx.shadowBlur = 0;
  ctx.font       = `${Math.min(w * 0.04, 22)}px 'Share Tech Mono', monospace`;
  ctx.fillStyle  = C.hud;

  const statY = h * 0.48;
  ctx.fillText(`SURVIVAL TIME   ${_formatTime(survivalMs)}`, w / 2, statY);
  ctx.fillText(`NEAR MISSES     ${player.nearMissCount}`, w / 2, statY + 34);

  const score = _calcScore(survivalMs, player.nearMissCount);
  ctx.fillStyle = C.nearMiss;
  ctx.font      = `${Math.min(w * 0.038, 20)}px 'Orbitron', monospace`;
  ctx.fillText(`SCORE  ${score.toLocaleString()}`, w / 2, statY + 80);

  if (bestScore > 0) {
    ctx.fillStyle = 'rgba(255,209,102,0.65)';
    ctx.font      = `${Math.min(w * 0.026, 14)}px 'Share Tech Mono', monospace`;
    ctx.fillText(`SESSION BEST  ${_formatTime(bestScore)}`, w / 2, statY + 116);
  }

  // Blinking restart prompt
  const blink = Math.floor(Date.now() / 550) % 2 === 0;
  if (blink) {
    ctx.font       = `${Math.min(w * 0.033, 18)}px 'Orbitron', monospace`;
    ctx.fillStyle  = C.dashReady;
    ctx.shadowColor = C.dashReady;
    ctx.shadowBlur  = 12;
    ctx.fillText('PRESS SPACE  /  TAP TO RESTART', w / 2, h * 0.78);
  }

  ctx.restore();
}

// ── Internal draw helpers ──────────────────────────────────────────────────

function _drawBackground(ctx, w, h) {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);

  // Rebuild grid cache if canvas was resized
  if (!_gridCanvas || _gridW !== w || _gridH !== h) {
    _buildGrid(w, h);
  }
  ctx.drawImage(_gridCanvas, 0, 0);

  // Subtle scanline effect — draw horizontal semi-transparent lines every 4px
  // Only redraw on even frames to save cost (imperceptible)
  ctx.fillStyle = 'rgba(0,0,0,0.06)';
  for (let y = 0; y < h; y += 4) {
    ctx.fillRect(0, y, w, 1);
  }
}

function _drawPackets(ctx, packets) {
  for (const p of packets) {
    if (!p.alive) continue;

    if (p.type === 'drifter') {
      _drawGlowCircle(ctx, p.x, p.y, p.radius, C.drifter, 12);
    } else if (p.type === 'seeker') {
      // Seeker has a directional "eye" notch
      _drawGlowCircle(ctx, p.x, p.y, p.radius, C.seeker, 16);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath();
      ctx.arc(p.radius * 0.35, 0, p.radius * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (p.type === 'pulse') {
      _drawPulse(ctx, p);
    }
  }
}

function _drawPulse(ctx, p) {
  if (p.pulsePhase === 'telegraph') {
    // Growing warning ring (TELEGRAPH_MS = 1100, inlined to avoid circular import)
    const progress = Math.min(p.pulseTimer / TELEGRAPH_MS, 1);
    const teleRadius = PLAYER_RADIUS + progress * 55;
    const alpha = 0.3 + Math.sin(p.pulseTimer * 0.012) * 0.3;

    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(teleRadius, 8), 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 34, 68, ${alpha})`;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Core dot
    _drawGlowCircle(ctx, p.x, p.y, PLAYER_RADIUS * 0.7, C.pulse, 8);

  } else if (p.pulsePhase === 'active') {
    // Danger zone expanding
    const alpha = 0.25 + Math.random() * 0.15; // slight flicker
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.pulseRadius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 34, 68, ${alpha})`;
    ctx.fill();
    ctx.strokeStyle = C.pulse;
    ctx.lineWidth = 2;
    ctx.stroke();

    _drawGlowCircle(ctx, p.x, p.y, PLAYER_RADIUS * 0.7, '#ff6688', 20);
  }
  // cooldown phase: invisible (already shrunk)
}

function _drawTrail(ctx, player) {
  const points = getTrailPoints();
  for (let i = 0; i < points.length; i++) {
    const alpha = (i / points.length) * 0.45;
    const radius = PLAYER_RADIUS * 0.55 * (i / points.length);
    if (radius < 0.5) continue;
    ctx.beginPath();
    ctx.arc(points[i].x, points[i].y, radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0, 200, 255, ${alpha})`;
    ctx.fill();
  }
}

function _drawPlayer(ctx, player) {
  const { x, y, radius, isInvincible, isDashing } = player;

  // Outer glow layers (cheap with shadowBlur)
  ctx.save();
  ctx.shadowColor = isInvincible ? '#ffffff' : C.playerGlow;
  ctx.shadowBlur  = isDashing ? 32 : 18;

  // Core fill
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = isInvincible ? '#ffffff' : C.player;
  ctx.fill();

  // Inner bright dot
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.45, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();

  // Dash cooldown ring
  _drawDashRing(ctx, x, y, radius + 5);
}

function _drawDashRing(ctx, x, y, r) {
  const frac = getDashCooldownFraction();
  const TAU  = Math.PI * 2;
  const startAngle = -Math.PI / 2; // top

  // Empty track
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.strokeStyle = C.dashEmpty;
  ctx.lineWidth   = 2;
  ctx.stroke();

  // Filled arc (clockwise fill as cooldown recovers)
  if (frac > 0.01) {
    ctx.save();
    ctx.shadowColor = C.dashReady;
    ctx.shadowBlur  = frac > 0.99 ? 10 : 0;
    ctx.beginPath();
    ctx.arc(x, y, r, startAngle, startAngle + frac * TAU);
    ctx.strokeStyle = frac >= 1 ? C.dashReady : 'rgba(0,180,220,0.8)';
    ctx.lineWidth   = 2;
    ctx.stroke();
    ctx.restore();
  }
}

function _drawParticles(ctx) {
  const particles = getActiveParticles();
  for (const p of particles) {
    ctx.save();
    if (p.glow) {
      ctx.shadowColor = p.color;
      ctx.shadowBlur  = 8;
    }
    ctx.globalAlpha = p.alpha;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(p.radius * p.life, 0.3), 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.restore();
  }
}

function _drawHUD(ctx, w, h, player, survivalMs, normalizedDifficulty) {
  ctx.save();
  ctx.textAlign = 'left';
  ctx.font      = `${Math.min(w * 0.032, 17)}px 'Share Tech Mono', monospace`;
  ctx.fillStyle = C.hud;

  // Elapsed time (top-left)
  ctx.fillText(`T  ${_formatTime(survivalMs)}`, 16, 30);

  // Near-miss counter (top-right)
  ctx.textAlign = 'right';
  ctx.fillStyle = C.nearMiss;
  ctx.fillText(`NEAR MISS  ×${player.nearMissCount}`, w - 16, 30);

  // Difficulty bar (subtle, bottom-right)
  const barW = 80;
  const barH = 4;
  const bx   = w - barW - 16;
  const by   = h - 24;
  ctx.fillStyle = 'rgba(0,200,255,0.15)';
  ctx.fillRect(bx, by, barW, barH);
  ctx.fillStyle = `hsl(${180 - normalizedDifficulty * 130}, 100%, 60%)`;
  ctx.fillRect(bx, by, barW * normalizedDifficulty, barH);

  ctx.restore();
}

// ── Utility ────────────────────────────────────────────────────────────────

function _drawGlowCircle(ctx, x, y, radius, color, blur) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur  = blur;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function _formatTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = String(s % 60).padStart(2, '0');
  const msDisplay = String(Math.floor((ms % 1000) / 10)).padStart(2, '0');
  return m > 0 ? `${m}:${sec}.${msDisplay}` : `${s}.${msDisplay}s`;
}

function _calcScore(survivalMs, nearMisses) {
  return Math.floor(survivalMs / 100) * 10 + nearMisses * 250;
}

// Expose to render game-over so score is consistent
export { _calcScore as calcScore };
