(() => {
  const headers = () => ({
    'Content-Type': 'application/json',
    ...(localStorage.topToken ? { Authorization: `Bearer ${localStorage.topToken}` } : {}),
    ...(localStorage.topPlayerId ? { 'X-Player-Id': localStorage.topPlayerId } : {})
  });
  const request = (path, options = {}) => fetch(`/api${path}`, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
  const install = () => {
    const resign = document.querySelector('#resign');
    if (!resign || document.querySelector('#drawOffer')) return;
    const gameId = location.hash.slice(1);
    const draw = document.createElement('button');
    draw.id = 'drawOffer'; draw.textContent = 'Ponudi remi';
    resign.insertAdjacentElement('afterend', draw);
    draw.onclick = async () => {
      const response = await request(`/games/${gameId}/draw-offer`, { method: 'POST' });
      if (response.ok) draw.textContent = 'Ponuda poslata';
    };
    const socket = window.io?.();
    if (socket) {
      socket.emit('join-game', gameId, localStorage.topPlayerId || '');
      socket.on('draw-offer', async () => {
        if (!confirm('Protivnik nudi remi. Prihvati?')) {
          await request(`/games/${gameId}/draw-decline`, { method: 'POST' });
          return;
        }
        await request(`/games/${gameId}/draw-accept`, { method: 'POST' });
      });
    }
  };
  new MutationObserver(install).observe(document.body, { childList: true, subtree: true });
})();
