import { el, label } from './dom.js';

/**
 * Fills a <tbody> with the standings.
 * `actions(c)` is optional: returns the elements for the last cell (admin only).
 */
export function renderRank(tbody, contestants, actions) {
  const sorted = [...contestants].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  tbody.closest('table')?.classList.toggle('dense', contestants.length > 12);
  const max = Math.max(1, ...sorted.map((c) => c.points));
  tbody.replaceChildren(...sorted.map((c, i) => {
    const tr = el('tr', { className: i < 3 && c.points > 0 ? `r${i + 1}` : '' },
      el('td', {}, el('span', { className: 'badge' }, String(i + 1))),
      el('td', {}, el('div', { className: 'name' }, label(c)), el('div', { className: 'bar' }, el('i'))),
      el('td', { className: 'pts' }, String(c.points)),
      ...(actions ? [el('td', { className: 'actions' }, ...actions(c))] : []),
    );
    tr.querySelector('.bar i').style.setProperty('--p', String(Math.round((c.points / max) * 100)));
    return tr;
  }));
}
