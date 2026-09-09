(() => {
  const headers = () => ({
    'Content-Type': 'application/json',
    ...(localStorage.topToken ? { Authorization: `Bearer ${localStorage.topToken}` } : {})
  });
  const api = (path, options = {}) => fetch(`/api${path}`, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
  let busy = false;
  async function enhance() {
    const feed = document.querySelector('#feed');
    if (!feed || busy || !feed.children.length) return;
    busy = true;
    try {
      const response = await api('/feed');
      if (!response.ok) return;
      const statuses = await response.json();
      [...feed.querySelectorAll('.status')].forEach((article, index) => {
        const status = statuses[index];
        if (!status || article.dataset.enhanced) return;
        article.dataset.enhanced = '1'; article.dataset.statusId = status.id;
        const actions = document.createElement('div'); actions.className = 'form-actions social-actions';
        actions.innerHTML = `<button data-social-like>♥ ${status.likes}</button><button data-social-reply>Odgovori</button>${status.username === JSON.parse(localStorage.topUser || 'null')?.username ? '<button data-social-edit>Izmeni</button><button data-social-delete>Obriši</button>' : ''}`;
        article.append(actions);
        actions.onclick = async event => {
          const button = event.target.closest('button'); if (!button) return;
          const id = article.dataset.statusId;
          if (button.dataset.socialLike !== undefined) { await api(`/statuses/${id}/like`, { method: 'POST' }); button.textContent = '♥'; return; }
          if (button.dataset.socialEdit !== undefined) { const body = prompt('Izmeni status', status.body); if (body) { await api(`/statuses/${id}`, { method: 'PATCH', body: JSON.stringify({ body }) }); article.querySelector('p').textContent = body; } return; }
          if (button.dataset.socialDelete !== undefined) { if (confirm('Obrisati status?')) { await api(`/statuses/${id}`, { method: 'DELETE' }); article.remove(); } return; }
          if (button.dataset.socialReply !== undefined) {
            const body = prompt('Napiši odgovor'); if (!body) return;
            await api(`/statuses/${id}/replies`, { method: 'POST', body: JSON.stringify({ body }) });
            button.textContent = 'Odgovoreno';
          }
        };
      });
    } finally { busy = false; }
  }
  new MutationObserver(enhance).observe(document.body, { childList: true, subtree: true });
})();
