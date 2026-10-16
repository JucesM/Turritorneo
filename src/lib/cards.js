import { el } from './dom.js';

const status = (c) => (c.champion ? `Campeón: ${c.champion}` : c.count < 2 ? 'Sin iniciar' : 'En juego');

/** Card grid of competitions. `href(c)` builds the link; `extra(c)` optional footer controls (admin). */
export function renderCards(root, competitions, href, extra) {
  if (!competitions.length) {
    root.replaceChildren(el('p', { className: 'empty-state' }, 'Aún no hay competencias.'));
    return;
  }
  root.replaceChildren(...competitions.map((c) => el('article', { className: `comp-card${c.champion ? ' done' : ''}` },
    el('a', { className: 'comp-link', href: href(c) },
      el('span', { className: 'comp-status' }, status(c)),
      el('h3', {}, c.name),
      el('span', { className: 'comp-meta' }, `${c.count} ${c.count === 1 ? 'participante' : 'participantes'}`),
      el('span', { className: 'comp-go', ariaHidden: 'true' }, '→')),
    ...(extra ? [el('div', { className: 'comp-actions' }, ...extra(c))] : []))));
}
