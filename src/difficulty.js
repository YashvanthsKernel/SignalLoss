/**
 * difficulty.js — Dynamic Difficulty Director
 *
 * This is the technical centerpiece of Signal Loss. Instead of a fixed
 * difficulty curve keyed purely to elapsed time, it uses a feedback loop:
 *
 *   - Tracks near-misses, dash usage, and survival time continuously.
 *   - Every EVAL_INTERVAL ms, computes a "pressure score" reflecting how
 *     challenged the player currently is.
 *   - Lerps current difficulty parameters toward a target set by the director,
 *     so changes feel organic rather than sudden "difficulty steps."
 *
 * All tunable constants live in difficultyConfig — change numbers here to
 * balance feel without touching game logic elsewhere.
 */

// ── Tunable Constants ──────────────────────────────────────────────────────
export const difficultyConfig = {
  // How often (ms) the director re-evaluates and adjusts the target params
  EVAL_INTERVAL: 3500,

  // Lerp factor applied each evaluation tick — lower = smoother, slower changes
  // 0.25 means we close 25% of the gap between current and target each tick.
  LERP_FACTOR: 0.28,

  // Spawn interval range (ms between packet spawns). Clamped to [min, max].
  SPAWN_INTERVAL_EASY: 1800,
  SPAWN_INTERVAL_HARD: 380,

  // Drifter speed range (px/s). Scales with difficulty.
  DRIFTER_SPEED_MIN_EASY: 80,
  DRIFTER_SPEED_MIN_HARD: 160,
  DRIFTER_SPEED_MAX_EASY: 150,
  DRIFTER_SPEED_MAX_HARD: 320,

  // Seeker turn rate (rad/s). Higher = harder to dodge.
  SEEKER_TURN_EASY: 0.8,
  SEEKER_TURN_HARD: 2.4,

  // Seeker base speed (px/s).
  SEEKER_SPEED_EASY: 70,
  SEEKER_SPEED_HARD: 180,

  // Pulse expand/contract timing
  PULSE_TELEGRAPH_MS: 1100, // warning ring phase duration
  PULSE_ACTIVE_MS: 420,     // danger zone active phase
  PULSE_COOLDOWN_MS: 2800,  // time between pulse spawns (at max difficulty)
  PULSE_COOLDOWN_EASY: 6000,

  // Max proportion of seekers vs total packets (0..1). Scales with difficulty.
  SEEKER_PROPORTION_EASY: 0.0,
  SEEKER_PROPORTION_HARD: 0.55,

  // Pulse proportion of spawn events (0..1)
  PULSE_PROPORTION_EASY: 0.0,
  PULSE_PROPORTION_HARD: 0.25,

  // Time thresholds (ms) for packet type introduction
  SEEKER_INTRO_TIME: 15000,  // seekers appear after 15s
  PULSE_INTRO_TIME: 30000,   // pulses appear after 30s

  // Near-miss scoring radius multiplier (relative to player radius)
  // A packet passing within this radius without hitting = near-miss
  NEAR_MISS_RADIUS_MULTIPLIER: 2.8,

  // Pressure score thresholds
  // If pressureScore > HIGH_PRESSURE, we ease off; if < LOW_PRESSURE, we ramp up.
  // near-miss rate target: ~1 near miss per 4 seconds = comfortable challenge
  PRESSURE_HIGH: 0.72,  // player is struggling — ease off
  PRESSURE_LOW:  0.28,  // player is cruising — ramp up

  // How fast max difficulty is reached in seconds of survival (for time-based floor)
  // Director won't go below this baseline escalation curve.
  TIME_FLOOR_FULL_HARD: 90,
};

// ── Runtime State ──────────────────────────────────────────────────────────

/** Current live parameters (lerped toward target by the director). */
export const params = {
  spawnInterval: difficultyConfig.SPAWN_INTERVAL_EASY,
  drifterSpeedMin: difficultyConfig.DRIFTER_SPEED_MIN_EASY,
  drifterSpeedMax: difficultyConfig.DRIFTER_SPEED_MAX_EASY,
  seekerProportion: difficultyConfig.SEEKER_PROPORTION_EASY,
  seekerTurnRate: difficultyConfig.SEEKER_TURN_EASY,
  seekerSpeed: difficultyConfig.SEEKER_SPEED_EASY,
  pulseProportion: difficultyConfig.PULSE_PROPORTION_EASY,
  pulseCooldown: difficultyConfig.PULSE_COOLDOWN_EASY,
  // 0 = easiest, 1 = hardest — a single normalized scalar for audio/visual use
  normalizedDifficulty: 0,
};

/** Tracking counters — reset at the start of each run. */
const stats = {
  survivalTime: 0,       // ms
  nearMissesTotal: 0,
  nearMissesRecent: 0,   // in the last EVAL_INTERVAL window
  dashCount: 0,
  dashCountRecent: 0,
  evalWindowStart: 0,
};

let _lastEvalTime = 0;

// ── Public API ─────────────────────────────────────────────────────────────

/** Call once at the start of a new run to reset all state. */
export function resetDifficulty() {
  params.spawnInterval       = difficultyConfig.SPAWN_INTERVAL_EASY;
  params.drifterSpeedMin     = difficultyConfig.DRIFTER_SPEED_MIN_EASY;
  params.drifterSpeedMax     = difficultyConfig.DRIFTER_SPEED_MAX_EASY;
  params.seekerProportion    = difficultyConfig.SEEKER_PROPORTION_EASY;
  params.seekerTurnRate      = difficultyConfig.SEEKER_TURN_EASY;
  params.seekerSpeed         = difficultyConfig.SEEKER_SPEED_EASY;
  params.pulseProportion     = difficultyConfig.PULSE_PROPORTION_EASY;
  params.pulseCooldown       = difficultyConfig.PULSE_COOLDOWN_EASY;
  params.normalizedDifficulty = 0;

  stats.survivalTime      = 0;
  stats.nearMissesTotal   = 0;
  stats.nearMissesRecent  = 0;
  stats.dashCount         = 0;
  stats.dashCountRecent   = 0;
  stats.evalWindowStart   = 0;
  _lastEvalTime           = 0;
}

/** Record a near-miss event from the collision system. */
export function recordNearMiss() {
  stats.nearMissesTotal++;
  stats.nearMissesRecent++;
}

/** Record a dash use from the player. */
export function recordDash() {
  stats.dashCount++;
  stats.dashCountRecent++;
}

/**
 * Update the difficulty director.
 * Called every frame from the main loop.
 * @param {number} survivalMs - total ms survived this run
 * @param {number} now - performance.now() or equivalent monotonic timestamp
 */
export function updateDifficulty(survivalMs, now) {
  stats.survivalTime = survivalMs;

  if (_lastEvalTime === 0) {
    _lastEvalTime = now;
    stats.evalWindowStart = now;
    return;
  }

  if (now - _lastEvalTime < difficultyConfig.EVAL_INTERVAL) return;

  // ── Evaluate ──────────────────────────────────────────────────────────
  const windowSec = (now - _lastEvalTime) / 1000;
  _lastEvalTime = now;

  // near-miss rate in this window (misses per second)
  const nmRate = stats.nearMissesRecent / Math.max(windowSec, 0.1);
  // dash rate in this window
  const dashRate = stats.dashCountRecent / Math.max(windowSec, 0.1);

  // Reset window counters
  stats.nearMissesRecent = 0;
  stats.dashCountRecent  = 0;

  // ── Compute pressure score (0..1) ─────────────────────────────────────
  // High nmRate = player is getting close calls = high pressure.
  // Lots of dashes = player is in danger = high pressure.
  // Target "comfortable challenge" nmRate ≈ 0.25/s (1 near-miss per 4s).
  const nmPressure   = Math.min(nmRate / 0.5, 1.0);   // saturates at 0.5/s
  const dashPressure = Math.min(dashRate / 0.8, 1.0);  // saturates at 0.8/s
  const pressureScore = nmPressure * 0.65 + dashPressure * 0.35;

  // ── Time-based floor ─────────────────────────────────────────────────
  // Ensures difficulty always rises with time even if player dodges perfectly.
  const timeFraction = Math.min(survivalMs / (difficultyConfig.TIME_FLOOR_FULL_HARD * 1000), 1.0);

  // ── Compute target normalized difficulty (0..1) ───────────────────────
  let targetNorm = params.normalizedDifficulty;

  if (pressureScore > difficultyConfig.PRESSURE_HIGH) {
    // Player is under heavy pressure — ease off a bit
    targetNorm -= 0.08;
  } else if (pressureScore < difficultyConfig.PRESSURE_LOW) {
    // Player is breezing — ramp up
    targetNorm += 0.12;
  } else {
    // Comfortable zone — drift up slowly anyway so the game always escalates
    targetNorm += 0.04;
  }

  // Time-based floor: difficulty can't drop below the time-curve floor
  targetNorm = Math.max(targetNorm, timeFraction * 0.9);
  targetNorm = Math.max(0, Math.min(1, targetNorm));

  // ── Lerp current params toward target ────────────────────────────────
  const t = difficultyConfig.LERP_FACTOR; // per eval-tick lerp (not per frame)
  const d = params;
  const c = difficultyConfig;

  params.normalizedDifficulty = lerp(d.normalizedDifficulty, targetNorm, t);
  const n = params.normalizedDifficulty;

  params.spawnInterval   = lerp(d.spawnInterval,   lerp(c.SPAWN_INTERVAL_EASY,    c.SPAWN_INTERVAL_HARD,    n), t);
  params.drifterSpeedMin = lerp(d.drifterSpeedMin, lerp(c.DRIFTER_SPEED_MIN_EASY, c.DRIFTER_SPEED_MIN_HARD, n), t);
  params.drifterSpeedMax = lerp(d.drifterSpeedMax, lerp(c.DRIFTER_SPEED_MAX_EASY, c.DRIFTER_SPEED_MAX_HARD, n), t);
  params.seekerTurnRate  = lerp(d.seekerTurnRate,  lerp(c.SEEKER_TURN_EASY,       c.SEEKER_TURN_HARD,       n), t);
  params.seekerSpeed     = lerp(d.seekerSpeed,     lerp(c.SEEKER_SPEED_EASY,      c.SEEKER_SPEED_HARD,      n), t);
  params.pulseCooldown   = lerp(d.pulseCooldown,   lerp(c.PULSE_COOLDOWN_EASY,    c.PULSE_COOLDOWN_MS,      n), t);

  // Packet type proportions only unlock after their intro time
  const seekerAvail  = survivalMs > c.SEEKER_INTRO_TIME  ? 1 : 0;
  const pulseAvail   = survivalMs > c.PULSE_INTRO_TIME   ? 1 : 0;

  params.seekerProportion = lerp(d.seekerProportion, lerp(c.SEEKER_PROPORTION_EASY, c.SEEKER_PROPORTION_HARD, n) * seekerAvail, t);
  params.pulseProportion  = lerp(d.pulseProportion,  lerp(c.PULSE_PROPORTION_EASY,  c.PULSE_PROPORTION_HARD,  n) * pulseAvail,  t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
