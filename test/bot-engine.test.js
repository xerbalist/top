import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { chooseBotMove, evaluatePosition } from '../lib/bot-engine.js';

test('bot returns a legal move without changing the supplied position', () => {
  const chess = new Chess();
  chess.move('e4');
  const before = chess.fen();
  const move = chooseBotMove(chess, { depth:2, random:() => 0 });

  assert.ok(move);
  assert.equal(chess.fen(), before);
  assert.doesNotThrow(() => chess.move(move));
});

test('bot takes a free high-value piece', () => {
  const chess = new Chess('4k3/8/8/8/8/8/q7/R3K3 b Q - 0 1');
  const move = chooseBotMove(chess, { depth:1, random:() => 0 });
  assert.deepEqual(move, { from:'a2', to:'a1', promotion:undefined });
});

test('position evaluation recognises material advantage and checkmate', () => {
  const advantage = new Chess('4k3/8/8/8/8/8/q7/4K3 b - - 0 1');
  assert.ok(evaluatePosition(advantage, 'b') > 800);

  const mate = new Chess('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1');
  assert.ok(evaluatePosition(mate, 'b') < -90000);
});
