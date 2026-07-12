/**
 * main.js — Entry Point & Game Loop
 *
 * Responsibilities:
 *   - Canvas setup and resize handling
 *   - requestAnimationFrame loop with delta-time clamping
 *   - State machine transitions (menu → playing → gameover → restart)
 *   - Wiring all modules together each frame
 *   - Hit-stop (1-frame freeze on death) and screen-shake trigger
 */

import { STATES, getCurrentState, setState, getBestScore, updateBestScore } from './state.js';
import { getIntent, isStartPressed, consumeStart } from './input.js';
import { player, resetPlayer, updatePlayer } from './player.js';
import { resetPackets, updatePackets, getActivePackets } from './packets.js';
import { resetDifficulty, updateDifficulty, params } from './difficulty.js';
import { resetParticles, updateParticles, emitBurst } from './particles.js';
import { initAudio, updateAmbient, playDeath, resumeAudio } from './audio.js';
import {
  renderGame, renderMenu, renderGameOver, shakeScreen, calcScore
} from './render.js';

// ── Canvas setup ──────────────────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');

let W = 0, H = 0;

function resizeCanvas() {
  W = canvas.width  = window.innerWidth;
  H = canvas.height = window.innerHeight;
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ── Runtime state ─────────────────────────────────────────────────────────
let survivalMs    = 0;  // ms elapsed this run
let lastTimestamp = 0;
let hitStopFrames = 0;  // >0 means freeze update (hit-stop effect on death)
let gameoverDelay = 0;  // brief delay before accepting restart input after death

// ── Game actions ──────────────────────────────────────────────────────────

function startNewRun() {
  survivalMs    = 0;
  hitStopFrames = 0;
  gameoverDelay = 0;

  resetPlayer(W, H);
  resetPackets();
  resetDifficulty();
  resetParticles();

  setState(STATES.PLAYING);
}

function triggerDeath() {
  // 1. Emit death particles
  emitBurst(player.x, player.y, 30, '#ff3355', {
    speed: 260,
    lifeMs: 700,
    radius: 4,
    glow: true,
  });
  emitBurst(player.x, player.y, 20, '#ff9900', {
    speed: 180,
    lifeMs: 500,
    radius: 2.5,
  });

  // 2. Screen shake
  shakeScreen(14);

  // 3. Hit-stop: freeze updates for 2 frames
  hitStopFrames = 2;

  // 4. Sound
  playDeath();

  // 5. Update best score
  const score = calcScore(survivalMs, player.nearMissCount);
  updateBestScore(survivalMs); // store raw time as best (score computed on render)

  // 6. Short delay before gameover screen accepts input (prevents accidental skip)
  gameoverDelay = 800; // ms

  setState(STATES.GAMEOVER);
}

// ── Main loop ─────────────────────────────────────────────────────────────

function loop(timestamp) {
  requestAnimationFrame(loop);

  // Compute delta time in ms, clamped to avoid huge jumps after tab-switch
  const rawDt = lastTimestamp ? timestamp - lastTimestamp : 16;
  const dt    = Math.min(rawDt, 50); // cap at 50ms (~20fps minimum)
  lastTimestamp = timestamp;

  const state = getCurrentState();

  // ── Menu ──────────────────────────────────────────────────────────────
  if (state === STATES.MENU) {
    renderMenu(ctx, W, H, getBestScore());

    if (isStartPressed()) {
      consumeStart();
      initAudio();
      resumeAudio();
      startNewRun();
    }
    return;
  }

  // ── Game Over ─────────────────────────────────────────────────────────
  if (state === STATES.GAMEOVER) {
    gameoverDelay -= dt;

    // Keep particles alive for the death burst
    updateParticles(dt);

    renderGame(ctx, W, H, player, getActivePackets(), survivalMs, params.normalizedDifficulty);
    renderGameOver(ctx, W, H, player, survivalMs, getBestScore());

    if (gameoverDelay <= 0 && isStartPressed()) {
      consumeStart();
      resumeAudio();
      startNewRun();
    }
    return;
  }

  // ── Playing ───────────────────────────────────────────────────────────
  if (state === STATES.PLAYING) {
    // Hit-stop: skip updates for N frames (still render, just frozen)
    if (hitStopFrames > 0) {
      hitStopFrames--;
      renderGame(ctx, W, H, player, getActivePackets(), survivalMs, params.normalizedDifficulty);
      return;
    }

    survivalMs += dt;

    // ── Get unified input intent ────────────────────────────────────────
    const intent = getIntent(canvas, player.x, player.y);

    // ── Update subsystems ───────────────────────────────────────────────
    updatePlayer(dt, intent, W, H);
    updateDifficulty(survivalMs, timestamp);
    updateAmbient(params.normalizedDifficulty);

    // updatePackets returns true if the player was hit
    const hit = updatePackets(dt, survivalMs, W, H);

    updateParticles(dt);

    if (hit && !player.isInvincible) {
      triggerDeath();
    }

    // ── Render ─────────────────────────────────────────────────────────
    renderGame(ctx, W, H, player, getActivePackets(), survivalMs, params.normalizedDifficulty);
  }
}

// Kick off
requestAnimationFrame(loop);
