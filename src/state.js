/**
 * state.js — Game State Machine
 *
 * States: 'menu' | 'playing' | 'gameover'
 * Transition rules are enforced here; everything else just reads currentState.
 */

export const STATES = Object.freeze({
  MENU: 'menu',
  PLAYING: 'playing',
  GAMEOVER: 'gameover',
});

let _current = STATES.MENU;

/** Session-best score (in-memory only, resets on page reload — intentional per spec) */
let _bestScore = 0;

export function getCurrentState() {
  return _current;
}

export function setState(next) {
  _current = next;
}

export function getBestScore() {
  return _bestScore;
}

export function updateBestScore(score) {
  if (score > _bestScore) _bestScore = score;
}
