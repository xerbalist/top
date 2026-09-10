import { Chess } from 'chess.js';

const squarePattern = /^[a-h][1-8]$/;

export function mirrorSquare(square) {
  const value = String(square || '').toLowerCase();
  if (!squarePattern.test(value)) return value;
  return `${value[0]}${9 - Number(value[1])}`;
}

export function moveForColor(move, color) {
  if (color !== 'b') return move;
  return {
    ...move,
    from: mirrorSquare(move.from),
    to: mirrorSquare(move.to)
  };
}

export function sameMove(first, second) {
  return Boolean(
    first &&
    second &&
    first.from === second.from &&
    first.to === second.to &&
    (first.promotion || null) === (second.promotion || null)
  );
}

export function advanceSequence(sequence, progress, played, color = 'w') {
  if (!Array.isArray(sequence) || !sequence.length) return 0;
  const expected = moveForColor(sequence[progress], color);
  if (sameMove(expected, played)) return progress + 1;

  const first = moveForColor(sequence[0], color);
  return sameMove(first, played) ? 1 : 0;
}

export function validatePersonalSequence(rawMoves, maximum = 5, color = 'w') {
  const moves = Array.isArray(rawMoves) ? rawMoves : [];
  if (moves.length > maximum) throw new Error('Previše poteza.');
  if (!['w', 'b'].includes(color)) throw new Error('Neispravna boja.');

  let chess = new Chess();
  if (color === 'b') {
    const initial = chess.fen().split(' ');
    initial[1] = 'b';
    chess = new Chess(initial.join(' '));
  }
  const history = [];

  for (const raw of moves) {
    if (!squarePattern.test(String(raw?.from || '')) || !squarePattern.test(String(raw?.to || ''))) {
      throw new Error('Neispravno polje.');
    }

    const played = chess.move({
      from: String(raw.from),
      to: String(raw.to),
      promotion: raw.promotion || 'q'
    });
    if (!played || played.color !== color) throw new Error('Nelegalan potez.');

    history.push({
      from: played.from,
      to: played.to,
      promotion: played.promotion || null,
      san: played.san,
      lan: played.lan
    });

    if (history.length < moves.length) {
      const fen = chess.fen().split(' ');
      fen[1] = color;
      fen[3] = '-';
      chess = new Chess(fen.join(' '));
    }
  }

  return { history, fen: chess.fen() };
}
