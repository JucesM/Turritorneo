export const $ = (s) => document.querySelector(s);

// textContent only -> no XSS from contestant names
export const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids);
  return n;
};

export const label = (c) => `${c.flag ? c.flag + ' ' : ''}${c.name}`;
