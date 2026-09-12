import { Worker } from 'node:worker_threads';
let active = 0;
const queue = [];
function drain() {
  if (active >= 2 || !queue.length) return;
  const { fen, resolve, reject } = queue.shift();
  active++;
  const worker = new Worker(new URL('./bot-worker.js', import.meta.url));
  let finished = false;
  const finish = (error, move) => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    worker.terminate().finally(() => { active--; drain(); });
    if (error) reject(error); else resolve(move);
  };
  const timeout = setTimeout(() => finish(new Error('Bot timeout')), 5000);
  worker.once('message', result => finish(result.error ? new Error('Bot failed') : null, result.move));
  worker.once('error', error => finish(error));
  worker.once('exit', () => finish(new Error('Bot exited')));
  worker.postMessage({fen});
}
export function botMove(fen) {
  if (queue.length >= 16) return Promise.reject(new Error('Bot busy'));
  return new Promise((resolve,reject) => { queue.push({fen,resolve,reject}); drain(); });
}
