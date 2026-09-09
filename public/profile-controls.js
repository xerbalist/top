(() => {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const loadSavedSequence = async () => {
    const board = document.querySelector('#secretBoard');
    if (!board || board.dataset.loaded) return;
    board.dataset.loaded = '1';
    const passwordButton = document.createElement('button');
    passwordButton.textContent = 'Promeni lozinku';
    passwordButton.style.marginTop = '14px';
    board.parentElement?.parentElement?.append(passwordButton);
    passwordButton.onclick = async () => {
      const currentPassword = prompt('Trenutna lozinka');
      const newPassword = prompt('Nova lozinka');
      if (!currentPassword || !newPassword) return;
      const result = await fetch('/api/auth/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.topToken}` }, body: JSON.stringify({ currentPassword, newPassword }) });
      const data = await result.json(); alert(data.error || 'Lozinka je promenjena.');
    };
    const token = localStorage.topToken;
    if (!token) return;
    const response = await fetch('/api/profile/secret-moves', { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) return;
    const data = await response.json();
    for (const move of data.moves || []) {
      const from = board.querySelector(`[data-square="${move.from}"]`);
      if (!from) return;
      from.click(); await wait(80);
      const to = board.querySelector(`[data-square="${move.to}"]`);
      if (!to) return;
      to.click(); await wait(120);
    }
  };
  new MutationObserver(loadSavedSequence).observe(document.body, { childList: true, subtree: true });
})();
