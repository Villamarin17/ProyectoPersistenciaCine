// Simulación de reproducción. El navegador avanza un reloj simulado y envía al servidor,
// cada 5 segundos, cuánto se reprodujo (sin contar los avances) y la posición actual.
(function () {
  const el = document.getElementById('player');
  const id = el.dataset.session;
  const duration = Number(el.dataset.duration);
  let position = Number(el.dataset.position);
  let watchedPending = 0, seekedPending = 0, watchedTotal = 0, seekedTotal = 0;
  let playing = false, ended = false, timer = null, last = 0;
  const $ = s => document.getElementById(s);
  const fmt = s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };

  function render() {
    $('progress').style.width = Math.min(100, 100 * position / duration) + '%';
    $('pos').textContent = fmt(position); $('watched').textContent = fmt(watchedTotal); $('seeked').textContent = fmt(seekedTotal);
    $('state').textContent = ended ? 'Terminado' : playing ? 'Reproduciendo…' : 'En pausa';
  }
  async function send(action) {
    const body = { watched: watchedPending, seeked: seekedPending, position };
    watchedPending = 0; seekedPending = 0;
    const r = await fetch('/api/reproduccion/' + id + '/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { $('msg').textContent = data.error || 'No se pudo guardar el progreso.'; if (r.status === 409) stopLocal(); }
    return data;
  }
  function tick() {
    const now = Date.now(), dt = (now - last) / 1000; last = now;
    const step = Math.min(dt * Number($('speed').value), duration - position);
    position += step; watchedPending += step; watchedTotal += step;
    if (position >= duration) return end(true);
    render();
  }
  let beat = null;
  function play() { if (ended || playing) return; playing = true; last = Date.now(); timer = setInterval(tick, 250); beat = setInterval(() => send('progreso'), 5000); render(); }
  function pause() { if (!playing) return; tick(); playing = false; clearInterval(timer); clearInterval(beat); send('progreso'); render(); }
  function stopLocal() { playing = false; ended = true; clearInterval(timer); clearInterval(beat); render(); }
  async function end(finished) {
    if (ended) return; if (playing) tick(); stopLocal();
    const r = await send(finished ? 'finalizar' : 'detener');
    $('msg').textContent = r.completed ? 'Sesión guardada: contenido completado.' : 'Sesión guardada. Aparecerá en Continuar viendo con la posición ' + fmt(position) + '.';
  }
  $('play').onclick = play; $('pause').onclick = pause;
  $('stop').onclick = () => end(false); $('finish').onclick = () => end(true);
  document.querySelectorAll('[data-seek]').forEach(b => b.onclick = () => {
    if (ended) return;
    const jump = Math.min(Number(b.dataset.seek), duration - position);
    position += jump; seekedPending += jump; seekedTotal += jump;   // el salto no suma tiempo visto
    render(); send('progreso');
  });
  // Si se cierra la pestaña se guarda la posición; si ni eso llega, el servidor cierra la sesión por inactividad
  window.addEventListener('pagehide', () => {
    if (ended) return;
    navigator.sendBeacon('/api/reproduccion/' + id + '/detener', new Blob([JSON.stringify({ watched: watchedPending, seeked: seekedPending, position })], { type: 'application/json' }));
  });
  render();
})();
