import { el, label } from './dom.js';

import { BYE, tournament } from './tournament.js';
const MIN_ZOOM = 0.45, FULL_MIN_ZOOM = 0.15, MAX_FULL_ZOOM = 1.6, DENSE_ABOVE = 16;
const ROUND_NAMES = ['Final', 'Semifinal', 'Cuartos', 'Octavos', 'Dieciseisavos'];

// static, trusted markup: gold cup + laurel wreath
function trophy() {
  const leaf = (k, side) => {
    const t = (100 + (k / 11) * 115) * (Math.PI / 180);
    const x = 100 + 72 * Math.cos(t) * side, y = 98 + 72 * Math.sin(t);
    const rot = ((side === 1 ? t : Math.PI - t) * 180) / Math.PI + 90 - 35 * side;
    return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="11" ry="4.5" transform="rotate(${rot.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})" fill="url(#g)"/>`;
  };
  const leaves = Array.from({ length: 12 }, (_, k) => leaf(k, 1) + leaf(k, -1)).join('');
  const wrap = el('div');
  wrap.innerHTML = `<svg class="trophy" viewBox="0 0 200 180" role="img" aria-label="Trofeo">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd677"/><stop offset=".55" stop-color="#ffbc2d"/><stop offset="1" stop-color="#c98712"/></linearGradient></defs>
    ${leaves}
    <path d="M72 38h56c0 38-14 54-28 58-14-4-28-20-28-58z" fill="url(#g)"/>
    <path d="M72 46c-22 0-22 30 6 36M128 46c22 0 22 30-6 36" fill="none" stroke="url(#g)" stroke-width="6" stroke-linecap="round"/>
    <rect x="94" y="96" width="12" height="20" fill="url(#g)"/>
    <path d="M76 116h48l5 16H71z" fill="url(#g)"/>
    <rect x="82" y="121" width="36" height="7" rx="1" fill="#0a1c3d"/>
  </svg>`;
  return wrap.firstElementChild;
}

/**
 * Draws the bracket into `root`.
 * `onPick(match, winnerId|null)` makes slots clickable (admin); omit for read-only view.
 */
// Scales the whole tree so it fits its box: width always, height too in fullscreen.
function fit(root) {
  const grid = root.firstElementChild;
  if (!grid?.classList.contains('grid')) return;
  const full = document.fullscreenElement?.contains(root);
  grid.style.zoom = 1; grid.style.minWidth = '';
  const { width, height } = grid.getBoundingClientRect();
  const cs = getComputedStyle(root);
  const availW = root.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const availH = root.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  let z = availW / width;
  if (full) z = Math.min(z, availH / height);
  z = Math.max(full ? FULL_MIN_ZOOM : MIN_ZOOM, Math.min(z, full ? MAX_FULL_ZOOM : 1));
  if (z < 1 || full) { grid.style.zoom = z.toFixed(3); grid.style.minWidth = '0'; }
}

export function renderBracket(root, state, onPick) {
  const ids = state.contestants.map((c) => c.id);
  if (ids.length < 2) {
    root.replaceChildren(el('p', { className: 'empty-state' }, 'Agrega al menos 2 concursantes para generar la llave.'));
    return;
  }
  const byId = (id) => state.contestants.find((c) => c.id === id);
  const { size, total, players, winnerOf } = tournament(state.contestants, state.picks);
  const roundName = (r) => ROUND_NAMES[total - 1 - r] ?? `Ronda ${r + 1}`;

  const matchEl = (r, i, withLabel) => {
    const [a, b] = players(r, i);
    const w = winnerOf(r, i);
    const isBye = r === 0 && (a === BYE || b === BYE);
    const slot = (id) => {
      const c = id && id !== BYE ? byId(id) : null;
      const cls = ['slot', !c ? 'empty' : '', id === BYE ? 'bye' : '', c && w && !isBye && id === w ? 'win' : '', c && w && !isBye && id !== w ? 'lose' : ''].join(' ');
      const text = c ? label(c) : id === BYE ? 'Pasa directo' : 'Por definir';
      if (!onPick) return el('div', { className: cls, title: text }, text);
      return el('button', {
        className: cls, title: text, ariaPressed: String(id === w), disabled: isBye || !a || !b,
        onclick: () => onPick(`${r}-${i}`, state.picks[`${r}-${i}`] === id ? null : id),
      }, text);
    };
    return el('div', { className: 'match' }, ...(withLabel ? [el('span', { className: 'lbl' }, roundName(r))] : []), slot(a), slot(b));
  };

  const node = (r, i) => {
    const perHalf = size / 2 ** (r + 1) / 2;
    const kids = r === 0 ? [] : [node(r - 1, 2 * i), node(r - 1, 2 * i + 1)];
    return el('div', { className: 'node' },
      ...(kids.length ? [el('div', { className: 'kids' }, ...kids)] : []),
      matchEl(r, i, i % perHalf === 0)); // label only the topmost match of each round per side
  };

  const champ = winnerOf(total - 1, 0);
  const hasSides = total > 1;
  const final = matchEl(total - 1, 0, true);
  final.classList.add('final');
  if (hasSides) final.classList.add('has-sides');

  const center = el('div', { className: 'center' }, trophy(), final,
    el('div', { className: 'champ' }, el('span', { className: 'lbl' }, 'Campeón'),
      el('div', { className: `slot ${champ ? 'win' : 'empty'}` }, champ ? label(byId(champ)) : 'Por definir')));

  root.replaceChildren(el('div', { className: 'grid' },
    ...(hasSides ? [el('div', { className: 'tree' }, node(total - 2, 0))] : []),
    center,
    ...(hasSides ? [el('div', { className: 'tree right' }, node(total - 2, 1))] : [])));
  root.classList.toggle('dense', ids.length > DENSE_ABOVE);
  fit(root);
  if (!root._fit) { root._fit = new ResizeObserver(() => fit(root)); root._fit.observe(root); }
}
