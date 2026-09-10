import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceSequence,
  mirrorSquare,
  moveForColor,
  validatePersonalSequence
} from '../lib/move-sequence.js';

const opening = [
  { from: 'e2', to: 'e4' },
  { from: 'g1', to: 'f3' },
  { from: 'f1', to: 'b5' },
  { from: 'e1', to: 'g1' },
  { from: 'd1', to: 'e2' }
];

test('validates five consecutive moves by the same white side', () => {
  const result = validatePersonalSequence(opening);
  assert.equal(result.history.length, 5);
  assert.deepEqual(result.history.map(move => move.san), ['e4', 'Nf3', 'Bb5', 'O-O', 'Qe2']);
});

test('mirrors a stored white move for a black player', () => {
  assert.equal(mirrorSquare('e2'), 'e7');
  assert.deepEqual(
    moveForColor({ from: 'g1', to: 'f3', promotion: null }, 'b'),
    { from: 'g8', to: 'f6', promotion: null }
  );
});

test('tracks exact order and can restart from the first move', () => {
  assert.equal(advanceSequence(opening, 0, { from: 'e2', to: 'e4' }), 1);
  assert.equal(advanceSequence(opening, 1, { from: 'a2', to: 'a3' }), 0);
  assert.equal(advanceSequence(opening, 3, { from: 'e2', to: 'e4' }), 1);
  assert.equal(advanceSequence(opening, 0, { from: 'e7', to: 'e5' }, 'b'), 1);
});

test('rejects illegal personal moves', () => {
  assert.throws(() => validatePersonalSequence([{ from: 'e2', to: 'e5' }]));
  assert.throws(() => validatePersonalSequence([{ from: 'e7', to: 'e5' }]));
});
