// Shared seeding and result validation for the browser and API.
export const BYE = 'BYE';
export function tournament(contestants, picks) {
  const ids = contestants.map(c => c.id);
  let size = 2;
  while (size < ids.length) size *= 2;
  let order = [1, 2];
  while (order.length < size) order = order.flatMap(x => [x, order.length * 2 + 1 - x]);
  const seeds = order.map(n => ids[n - 1] ?? BYE);
  const total = Math.log2(size);
  const players = (r, i) => r === 0 ? [seeds[2 * i], seeds[2 * i + 1]] : [winnerOf(r - 1, 2 * i), winnerOf(r - 1, 2 * i + 1)];
  const winnerOf = (r, i) => {
    const [a, b] = players(r, i);
    if (r === 0) { if (a === BYE) return b; if (b === BYE) return a; }
    const p = picks[`${r}-${i}`];
    return a && b && (p === a || p === b) ? p : null;
  };
  return { size, total, players, winnerOf };
}
export function prunePicks(state) {
  const { size, total, players } = tournament(state.contestants, state.picks);
  for (let r = 0; r < total; r++) for (let i = 0; i < size / 2 ** (r + 1); i++) {
    const [a, b] = players(r, i), key = `${r}-${i}`;
    if (!a || !b || a === BYE || b === BYE || ![a, b].includes(state.picks[key])) delete state.picks[key];
  }
}
