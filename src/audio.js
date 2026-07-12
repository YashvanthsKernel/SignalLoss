/**
 * audio.js — Web Audio API Procedural Sound Engine
 *
 * All sounds generated via oscillators/gain nodes — zero external assets.
 * The ambient drone pitch is modulated in real time by the difficulty director.
 *
 * Audiocontext is lazily created on first user gesture (browser policy).
 */

let _ctx = null;
let _ambientOsc = null;
let _ambientGain = null;
let _masterGain = null;

// Current ambient base frequency — raised by difficulty
let _ambientFreq = 55; // Hz — low A1

/** Initialize audio context on first user gesture. Safe to call multiple times. */
export function initAudio() {
  if (_ctx) return;
  try {
    _ctx = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) {
    console.warn('Web Audio not available:', e);
    return;
  }

  _masterGain = _ctx.createGain();
  _masterGain.gain.setValueAtTime(0.35, _ctx.currentTime);
  _masterGain.connect(_ctx.destination);

  _startAmbient();
}

function _startAmbient() {
  if (!_ctx) return;

  // Two detuned oscillators for a richer drone texture
  _ambientOsc = _ctx.createOscillator();
  _ambientOsc.type = 'sine';
  _ambientOsc.frequency.setValueAtTime(_ambientFreq, _ctx.currentTime);

  const osc2 = _ctx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(_ambientFreq * 1.01, _ctx.currentTime); // slight detune

  // LFO modulates gain to create subtle pulsing drone
  const lfo = _ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.setValueAtTime(0.5, _ctx.currentTime); // 0.5 Hz pulse
  const lfoGain = _ctx.createGain();
  lfoGain.gain.setValueAtTime(0.04, _ctx.currentTime);
  lfo.connect(lfoGain);

  _ambientGain = _ctx.createGain();
  _ambientGain.gain.setValueAtTime(0.08, _ctx.currentTime);
  lfoGain.connect(_ambientGain.gain);

  _ambientOsc.connect(_ambientGain);
  osc2.connect(_ambientGain);
  _ambientGain.connect(_masterGain);

  _ambientOsc.start();
  osc2.start();
  lfo.start();
}

/**
 * Update ambient drone pitch based on normalized difficulty (0..1).
 * Called every frame from main loop.
 */
export function updateAmbient(normalizedDifficulty) {
  if (!_ctx || !_ambientOsc) return;
  // Map difficulty 0..1 to frequency 55..110 Hz (one octave rise)
  const targetFreq = 55 + normalizedDifficulty * 55;
  // Use setTargetAtTime for smooth frequency glide (no clicks)
  _ambientOsc.frequency.setTargetAtTime(targetFreq, _ctx.currentTime, 0.5);
}

/** Short upward pitch sweep — triggered on dash. */
export function playDash() {
  if (!_ctx) return;
  const osc  = _ctx.createOscillator();
  const gain = _ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(300, _ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(900, _ctx.currentTime + 0.12);
  gain.gain.setValueAtTime(0.18, _ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, _ctx.currentTime + 0.18);
  osc.connect(gain);
  gain.connect(_masterGain);
  osc.start(_ctx.currentTime);
  osc.stop(_ctx.currentTime + 0.2);
}

/** Soft chime — triggered on near-miss. */
export function playNearMiss() {
  if (!_ctx) return;
  const osc  = _ctx.createOscillator();
  const gain = _ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, _ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(1100, _ctx.currentTime + 0.08);
  gain.gain.setValueAtTime(0.10, _ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, _ctx.currentTime + 0.25);
  osc.connect(gain);
  gain.connect(_masterGain);
  osc.start(_ctx.currentTime);
  osc.stop(_ctx.currentTime + 0.28);
}

/** Descending tone + noise burst — triggered on collision/game over. */
export function playDeath() {
  if (!_ctx) return;

  // Descending tone
  const osc  = _ctx.createOscillator();
  const gain = _ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(440, _ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(60, _ctx.currentTime + 0.6);
  gain.gain.setValueAtTime(0.3, _ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, _ctx.currentTime + 0.7);
  osc.connect(gain);
  gain.connect(_masterGain);
  osc.start(_ctx.currentTime);
  osc.stop(_ctx.currentTime + 0.75);

  // Noise burst (white noise via buffer)
  _playNoise(0.3, 0.35);
}

function _playNoise(durationSec, volume) {
  if (!_ctx) return;
  const bufSize = _ctx.sampleRate * durationSec;
  const buf     = _ctx.createBuffer(1, bufSize, _ctx.sampleRate);
  const data    = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;

  const src  = _ctx.createBufferSource();
  const gain = _ctx.createGain();
  src.buffer = buf;
  gain.gain.setValueAtTime(volume, _ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, _ctx.currentTime + durationSec);
  src.connect(gain);
  gain.connect(_masterGain);
  src.start(_ctx.currentTime);
}

/** Mute/unmute (for tab-switch or user preference). */
export function setMasterVolume(vol) {
  if (!_ctx || !_masterGain) return;
  _masterGain.gain.setTargetAtTime(vol, _ctx.currentTime, 0.05);
}

/** Resume AudioContext after user gesture (required in some browsers). */
export function resumeAudio() {
  if (_ctx && _ctx.state === 'suspended') {
    _ctx.resume();
  }
}
