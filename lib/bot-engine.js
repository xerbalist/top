const PIECE_VALUE = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 0
};

const MATE_SCORE = 100000;

function positionalBonus(piece) {
  const file = piece.square.charCodeAt(0) - 97;
  const rank = Number(piece.square[1]) - 1;
  const centerDistance = Math.abs(file - 3.5) + Math.abs(rank - 3.5);
  const center = Math.max(0, 4 - centerDistance);
  const advance = piece.color === 'w' ? rank : 7 - rank;

  if (piece.type === 'p') return advance * 5 + center * 2;
  if (piece.type === 'n' || piece.type === 'b') return center * 7;
  if (piece.type === 'q') return center * 2;
  return 0;
}

export function evaluatePosition(chess, perspective = 'b') {
  if (chess.isCheckmate()) {
    return chess.turn() === perspective ? -MATE_SCORE : MATE_SCORE;
  }
  if (chess.isDraw()) return 0;

  let score = 0;
  for (const row of chess.board()) {
    for (const piece of row) {
      if (!piece) continue;
      const value = PIECE_VALUE[piece.type] + positionalBonus(piece);
      score += piece.color === perspective ? value : -value;
    }
  }

  const mobility = chess.moves().length * 2;
  score += chess.turn() === perspective ? mobility : -mobility;
  return score;
}

function plainMove(move) {
  return { from:move.from, to:move.to, promotion:move.promotion || undefined };
}

function orderedMoves(chess) {
  return chess.moves({ verbose:true }).sort((first, second) => {
    const priority = move =>
      (move.captured ? PIECE_VALUE[move.captured] * 10 - PIECE_VALUE[move.piece] : 0) +
      (move.promotion ? PIECE_VALUE[move.promotion] : 0) +
      (move.san.includes('#') ? MATE_SCORE : move.san.includes('+') ? 50 : 0);
    return priority(second) - priority(first);
  });
}

function search(chess, depth, alpha, beta, perspective) {
  if (depth <= 0 || chess.isGameOver()) return evaluatePosition(chess, perspective);
  const maximizing = chess.turn() === perspective;
  let best = maximizing ? -Infinity : Infinity;

  for (const move of orderedMoves(chess)) {
    chess.move(plainMove(move));
    const score = search(chess, depth - 1, alpha, beta, perspective);
    chess.undo();

    if (maximizing) {
      best = Math.max(best, score);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, score);
      beta = Math.min(beta, best);
    }
    if (beta <= alpha) break;
  }
  return best;
}

export function chooseBotMove(chess, { depth = 2, random = Math.random } = {}) {
  if (chess.isGameOver()) return null;
  const perspective = chess.turn();
  const safeDepth = Math.max(1, Math.min(3, Number(depth) || 2));
  const ranked = [];

  for (const move of orderedMoves(chess)) {
    chess.move(plainMove(move));
    const score = search(chess, safeDepth - 1, -Infinity, Infinity, perspective);
    chess.undo();
    ranked.push({ move:plainMove(move), score });
  }

  ranked.sort((first, second) => second.score - first.score);
  const bestScore = ranked[0]?.score;
  const candidates = ranked.filter(entry => entry.score >= bestScore - 12).slice(0, 3);
  if (!candidates.length) return null;
  const index = Math.min(candidates.length - 1, Math.floor(random() * candidates.length));
  return candidates[index].move;
}
