// Single place that talks to the Node API.
const call = async (path, method = 'GET', body) => {
  const res = await fetch(`/api/${path}`, {
    method,
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => { throw new Error('Respuesta inválida del servidor.'); });
  if (!res.ok) throw Object.assign(new Error(data.error || 'Error'), { status: res.status });
  return data;
};
const comp = (data) => {
  if (!data || !Array.isArray(data.contestants) || !data.picks) throw new Error('Estado inválido del servidor.');
  return data;
};

export const listCompetitions = async () => {
  const data = await call('competitions');
  if (!Array.isArray(data.competitions)) throw new Error('Estado inválido del servidor.');
  return data.competitions;
};
export const createCompetition = (name) => call('competitions', 'POST', { name });
export const renameCompetition = (cid, name) => call(`competitions/${cid}`, 'PATCH', { name }).then(comp);
export const deleteCompetition = (cid) => call(`competitions/${cid}`, 'DELETE');
export const getCompetition = (cid) => call(`competitions/${cid}`).then(comp);
export const addContestant = (cid, name, flag) => call(`competitions/${cid}/contestants`, 'POST', { name, flag }).then(comp);
export const addPoints = (cid, id, delta) => call(`competitions/${cid}/contestants/${id}`, 'PATCH', { delta }).then(comp);
export const removeContestant = (cid, id) => call(`competitions/${cid}/contestants/${id}`, 'DELETE').then(comp);
export const setPick = (cid, match, winner) => call(`competitions/${cid}/picks`, 'PUT', { match, winner }).then(comp);

const auth = async (path, body) => {
  const res = await fetch(`/api/${path}`, { method: body ? 'POST' : 'GET', cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body && JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error');
  return data.admin;
};
export const isAdmin = () => auth('session');
export const login = (user, password) => auth('login', { user, password });
export const logout = () => auth('logout', {});
