// Wires a button to toggle fullscreen on `target`; hides it where unsupported.
// On phones it also asks for landscape, where a wide bracket fits much better.
export function setupFullscreen(btn, target) {
  if (!document.fullscreenEnabled) { btn.hidden = true; return; }
  const sync = () => {
    const on = document.fullscreenElement === target;
    btn.textContent = on ? 'Salir de pantalla completa' : 'Pantalla completa';
    if (!on) screen.orientation?.unlock?.();
  };
  btn.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) return await document.exitFullscreen();
      await target.requestFullscreen();
      await screen.orientation?.lock?.('landscape').catch(() => {}); // unsupported on desktop/iOS: ignore
    } catch { /* fullscreen refused */ }
  });
  document.addEventListener('fullscreenchange', sync);
  sync();
}
