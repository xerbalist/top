import { parentPort } from 'node:worker_threads';
import { Chess } from 'chess.js';
import { chooseBotMove } from './bot-engine.js';
parentPort.on('message', ({fen}) => {
  try { parentPort.postMessage({move:chooseBotMove(new Chess(fen),{depth:2})}); }
  catch { parentPort.postMessage({error:true}); }
});
