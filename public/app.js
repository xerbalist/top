const root = document.querySelector('#root');
let me = JSON.parse(localStorage.topUser || 'null');
let activeSocket = null;
let accountSocket = null;
let loggingOut = false;

const esc = value => String(value).replace(
  /[&<>"']/g,
  character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]
);

function topDialog({
  title = 'TOP',
  message = '',
  fields = [],
  confirmText = 'U redu',
  cancelText = null,
  danger = false
} = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay top-dialog-overlay';
    const fieldMarkup = fields.map(field => {
      const attributes = [
        `name="${esc(field.name)}"`,
        field.required ? 'required' : '',
        field.readonly ? 'readonly' : '',
        field.autocomplete ? `autocomplete="${esc(field.autocomplete)}"` : '',
        field.minlength ? `minlength="${Number(field.minlength)}"` : '',
        field.maxlength ? `maxlength="${Number(field.maxlength)}"` : '',
        field.placeholder ? `placeholder="${esc(field.placeholder)}"` : ''
      ].filter(Boolean).join(' ');
      const control = field.multiline
        ? `<textarea ${attributes} rows="${Number(field.rows) || 4}">${esc(field.value || '')}</textarea>`
        : `<input ${attributes} type="${esc(field.type || 'text')}" value="${esc(field.value || '')}">`;
      return `<label class="top-dialog-field"><span>${esc(field.label)}</span>${control}</label>`;
    }).join('');

    overlay.innerHTML = `
      <section class="card top-dialog" role="dialog" aria-modal="true" aria-labelledby="topDialogTitle">
        <header class="top-dialog-header">
          <div><small>TOP</small><h2 id="topDialogTitle">${esc(title)}</h2></div>
        </header>
        <form class="top-dialog-form">
          <div class="top-dialog-body">
            ${message ? `<p class="top-dialog-message">${esc(message)}</p>` : ''}
            ${fieldMarkup ? `<div class="top-dialog-fields">${fieldMarkup}</div>` : ''}
          </div>
          <footer class="top-dialog-actions">
            ${cancelText ? `<button type="button" data-dialog-cancel>${esc(cancelText)}</button>` : ''}
            <button type="submit" class="${danger ? 'danger' : 'primary'}">${esc(confirmText)}</button>
          </footer>
        </form>
      </section>
    `;
    document.body.appendChild(overlay);

    const form = overlay.querySelector('form');
    let finished = false;
    const finish = value => {
      if (finished) return;
      finished = true;
      document.removeEventListener('keydown', onKeydown);
      overlay.remove();
      resolve(value);
    };
    const cancel = () => finish(null);
    const onKeydown = event => {
      if (event.key === 'Escape' && cancelText) cancel();
    };
    document.addEventListener('keydown', onKeydown);
    form.onsubmit = event => {
      event.preventDefault();
      finish(Object.fromEntries(new FormData(form)));
    };
    overlay.querySelector('[data-dialog-cancel]')?.addEventListener('click', cancel);
    overlay.addEventListener('mousedown', event => {
      if (event.target === overlay && cancelText) cancel();
    });
    requestAnimationFrame(() => (form.querySelector('input, textarea, button') || form).focus());
  });
}

async function topAlert(message, title = 'Obaveštenje') {
  await topDialog({ title, message });
}

async function topConfirm(message, { title = 'Potvrda', confirmText = 'Potvrdi', danger = false } = {}) {
  return Boolean(await topDialog({ title, message, confirmText, cancelText:'Odustani', danger }));
}

async function topPrompt(label, {
  title = 'Unos', value = '', placeholder = '', multiline = false, required = false, readonly = false
} = {}) {
  const result = await topDialog({
    title,
    fields:[{ name:'value', label, value, placeholder, multiline, required, readonly }],
    confirmText:readonly ? 'Zatvori' : 'Potvrdi',
    cancelText:readonly ? null : 'Odustani'
  });
  return result?.value ?? null;
}

function avatarHtml(user, fallback = 'G') {
  const avatar = String(user?.avatar || '');
  if (/^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(avatar)) {
    return `<img src="${avatar}" alt="">`;
  }
  return esc(user?.username?.[0]?.toUpperCase() || fallback);
}

function updateSidebarUser() {
  const userButton = document.querySelector('#sidebarUser');
  document.querySelector('#sidebarAvatar').innerHTML = avatarHtml(me);
  document.querySelector('#sidebarUsername').textContent = me?.username || 'Gost';
  document.querySelector('#sidebarCountry').textContent = me?.country || (me ? 'TOP igrač' : 'Bez naloga');
  userButton.dataset.view = me ? 'profile' : 'login';
}

async function api(url, options = {}) {
  const response = await fetch(`/api${url}`, {
    ...options,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(localStorage.topPlayerId ? { 'X-Player-Id': localStorage.topPlayerId } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Greška');
  return data;
}

function layout(content) {
  activeSocket?.disconnect();
  activeSocket = null;
  root.innerHTML = content;
  const authButton = document.querySelector('#authBtn');
  authButton.innerHTML = me
    ? '<span>Odjava</span>'
    : '<span>Prijava</span>';
  authButton.dataset.view = me ? 'logout' : 'login';
  updateSidebarUser();
  document.querySelectorAll('[data-view]').forEach(button => {
    button.onclick = () => navigate(button.dataset.view);
  });
  document.querySelectorAll('[data-action]').forEach(button => {
    button.onclick = () => handleSidebarAction(button.dataset.action);
  });
}

function navigate(viewName) {
  if (viewName !== 'game' && location.hash) history.replaceState(null, '', location.pathname);
  view(viewName);
}

function openGame(id) {
  if (location.hash.slice(1) === id) gamePage(id);
  else location.hash = id;
}

async function handleSidebarAction(action) {
  if (action === 'bot-game') return view('home');
  if (action === 'join-game') {
    const id = (await topPrompt('Kod ili ID partije', {
      title:'Pridruži se partiji',
      placeholder:'Na primer: a1b2c3d4',
      required:true
    }))?.trim();
    if (id) openGame(id);
    return;
  }
  if (action === 'new-game') {
    try {
      const data = await api('/games', { method:'POST', body:'{}' });
      if (data.playerId) localStorage.topPlayerId = data.playerId;
      openGame(data.id);
    } catch (error) {
      await topAlert(error.message, 'Partija nije napravljena');
    }
  }
}

async function performLogout() {
  if (loggingOut) return;
  loggingOut = true;
  try {
    await api('/auth/logout', { method:'POST', body:'{}' });
  } catch {}
  localStorage.removeItem('topToken');
  localStorage.removeItem('topUser');
  localStorage.removeItem('topPlayerId');
  me = null;
  syncAccountSocket();
  loggingOut = false;
  view('home');
}

function syncAccountSocket() {
  if (!me) {
    accountSocket?.disconnect();
    accountSocket = null;
    return;
  }
  if (accountSocket) return;
  accountSocket = io();
  accountSocket.on('challenge-accepted', ({ gameId } = {}) => {
    if (!gameId) return;
    localStorage.removeItem('topPlayerId');
    openGame(gameId);
  });
}

function view(viewName = 'home') {
  document.body.dataset.page = viewName;
  if (viewName === 'logout') {
    return performLogout();
  }
  if (viewName === 'login') return authPage(false);
  if (viewName === 'register') return authPage(true);
  if (viewName === 'friends') return friendsPage();
  if (viewName === 'profile') return profilePage();
  if (viewName === 'game') return gamePage(location.hash.slice(1));
  return homePage();
}

function showMnemonic(phrase, username) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <section class="card mnemonic-modal top-dialog" role="dialog" aria-modal="true" aria-labelledby="mnemonicTitle">
        <header class="top-dialog-header">
          <div><small>TOP</small><h2 id="mnemonicTitle">Sačuvaj mnemonic frazu</h2></div>
        </header>
        <div class="top-dialog-body">
          <p>Ovo je jedini način za oporavak naloga. Fraza se više neće prikazati.</p>
          <textarea id="mnemonicValue" readonly rows="4">${esc(phrase)}</textarea>
          <div class="form-actions mnemonic-tools">
            <button id="copyMnemonic">Kopiraj frazu</button>
            <button id="downloadMnemonic">Preuzmi kao .txt</button>
          </div>
          <label class="confirm-line">
            <input id="mnemonicSaved" type="checkbox">
            Sačuvao/la sam frazu na sigurnom mestu
          </label>
        </div>
        <footer class="top-dialog-actions">
          <button id="finishRegistration" class="primary" disabled>Nastavi</button>
        </footer>
      </section>
    `;
    document.body.appendChild(overlay);

    const saved = overlay.querySelector('#mnemonicSaved');
    const finish = overlay.querySelector('#finishRegistration');
    saved.onchange = () => { finish.disabled = !saved.checked; };
    overlay.querySelector('#copyMnemonic').onclick = async () => {
      try {
        await navigator.clipboard.writeText(phrase);
        overlay.querySelector('#copyMnemonic').textContent = 'Kopirano';
      } catch {
        overlay.querySelector('#mnemonicValue').select();
      }
    };
    overlay.querySelector('#downloadMnemonic').onclick = () => {
      const content = `TOP — mnemonic fraza za oporavak\nKorisničko ime: ${username}\n\n${phrase}\n\nČuvaj ovaj fajl na sigurnom mestu.`;
      const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `TOP-mnemonic-${username}.txt`;
      link.click();
      URL.revokeObjectURL(url);
    };
    finish.onclick = () => {
      overlay.remove();
      resolve();
    };
  });
}

function authPage(registering) {
  layout(`
    <div class="auth-stage">
      <section class="card auth-card">
        <div class="auth-heading">
          <div><small>Dobro došao/la u TOP</small><h1>${registering ? 'Registracija' : 'Prijava'}</h1></div>
        </div>
        <form id="auth">
          <input name="username" placeholder="Korisničko ime" autocomplete="username" required>
          <input name="password" type="password" placeholder="Lozinka" autocomplete="${registering ? 'new-password' : 'current-password'}" required minlength="8">
          ${registering ? '<p class="muted auth-note">Posle registracije dobićeš mnemonic frazu za oporavak naloga.</p>' : ''}
          <button class="primary">${registering ? 'Napravi nalog' : 'Prijavi se'}</button>
        </form>
        <div class="auth-secondary">
          <span class="muted">${registering ? 'Već imaš nalog?' : 'Nemaš nalog?'}</span>
          <button id="switch">${registering ? 'Prijava' : 'Registracija'}</button>
          ${registering ? '' : '<button id="recover">Oporavak naloga</button>'}
        </div>
      </section>
    </div>
  `);

  document.querySelector('#switch').onclick = () => view(registering ? 'login' : 'register');
  document.querySelector('#auth').onsubmit = async event => {
    event.preventDefault();
    try {
      const data = await api(registering ? '/auth/register' : '/auth/login', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(new FormData(event.target)))
      });
      me = data.user;
      localStorage.removeItem('topToken');
      localStorage.removeItem('topPlayerId');
      localStorage.topUser = JSON.stringify(me);
      syncAccountSocket();
      if (data.mnemonic) {
        await showMnemonic(data.mnemonic, data.user.username);
      }
      view('home');
    } catch (error) {
      await topAlert(error.message, registering ? 'Registracija nije uspela' : 'Prijava nije uspela');
    }
  };

  document.querySelector('#recover')?.addEventListener('click', async () => {
    const credentials = await topDialog({
      title:'Oporavak naloga',
      message:'Unesi mnemonic reči tačnim redom. Ovo je jedini način za oporavak naloga.',
      fields:[
        { name:'username', label:'Korisničko ime', required:true, autocomplete:'username' },
        { name:'mnemonic', label:'Mnemonic fraza', required:true, multiline:true, rows:3, placeholder:'sova golub motika…' },
        { name:'password', label:'Nova lozinka', required:true, type:'password', minlength:8, autocomplete:'new-password' }
      ],
      confirmText:'Promeni lozinku',
      cancelText:'Odustani'
    });
    if (!credentials) return;
    try {
      await api('/auth/recover', {
        method: 'POST',
        body: JSON.stringify(credentials)
      });
      await topAlert('Lozinka je uspešno promenjena.', 'Nalog je oporavljen');
    } catch (error) {
      await topAlert(error.message, 'Oporavak nije uspeo');
    }
  });
}

function homePage() {
  layout(`
    <section class="home-chess">
      <div class="board-column home-board-column">
        <div class="player-bar">
          <span class="player-avatar bot-avatar">♞</span>
          <span><b>TOP Bot</b><small id="homeOpponentStatus">lagani nivo</small></span>
          <span class="online-dot" title="Dostupan"></span>
        </div>
        <div id="homeBoard" class="board" aria-label="Tabla za igru protiv TOP Bota"></div>
        <div class="player-bar">
          <span class="player-avatar">${avatarHtml(me)}</span>
          <span><b>${me ? esc(me.username) : 'Gost'}</b><small>${me ? 'igraš belim figurama' : 'igraj bez naloga'}</small></span>
        </div>
      </div>
      <aside class="card home-actions bot-home-panel">
        <div class="game-panel-title home-panel-title">
          <span class="panel-rook">♞</span>
          <div><h2>Partija protiv TOP Bota</h2><small>Igraš belim figurama</small></div>
        </div>
        <div class="turn-banner" id="homeBotStatus" data-state="active">Klikni belu figuru i odigraj potez.</div>
        <div class="bot-guide">
          <h3>Tabla je spremna</h3>
          <p>Izaberi figuru direktno na velikoj tabli. Oznake će pokazati gde možeš da je pomeriš.</p>
          <div id="homeBotMoves" class="moves compact-moves">Još nema poteza.</div>
          <p class="muted">Za novu bot partiju ponovo klikni „Igraj sa botom“ u meniju.</p>
        </div>
      </aside>
    </section>
  `);

  const initialFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  let gameId = null;
  let state = { fen:initialFen, legalMoves:[], history:[], turn:'w', botThinking:false, gameOver:false };
  let selected = null;
  let starting = false;

  function drawHomeGame() {
    const legalTargets = selected
      ? (state.legalMoves || []).filter(move => move.from === selected).map(move => move.to)
      : [];
    renderBoard(document.querySelector('#homeBoard'), state.fen, selected, playHomeMove, 'w', {
      lastMove:state.lastMove,
      legalTargets
    });
    document.querySelector('#homeOpponentStatus').textContent = state.botThinking ? 'razmišlja…' : 'lagani nivo';
    document.querySelector('#homeBotStatus').textContent = state.gameOver
      ? `Partija završena${state.endReason ? ` — ${state.endReason}` : ''}`
      : state.botThinking
        ? 'TOP Bot razmišlja…'
        : gameId ? 'Ti si na potezu' : 'Klikni belu figuru i odigraj potez.';
    document.querySelector('#homeBotStatus').dataset.state = state.gameOver ? 'ended' : state.botThinking ? 'waiting' : 'active';
    document.querySelector('#homeBotMoves').textContent = state.history?.join(' · ') || 'Još nema poteza.';
  }

  async function ensureHomeGame() {
    if (gameId || starting) return;
    starting = true;
    document.querySelector('#homeBotStatus').textContent = 'Pripremam partiju…';
    try {
      const created = await api('/games/bot', { method:'POST', body:'{}' });
      gameId = created.id;
      if (created.playerId) localStorage.topPlayerId = created.playerId;
      state = await api(`/games/${gameId}`);
      const socket = io({ auth:{ playerId:localStorage.topPlayerId || '' } });
      activeSocket = socket;
      socket.emit('join-game', gameId);
      socket.on('state', nextState => {
        state = { ...state, ...nextState };
        selected = null;
        drawHomeGame();
      });
    } catch (error) {
      gameId = null;
      await topAlert(error.message, 'Bot partija nije pokrenuta');
    } finally {
      starting = false;
      drawHomeGame();
    }
  }

  async function playHomeMove(square) {
    await ensureHomeGame();
    if (!gameId || state.gameOver || state.botThinking || state.turn !== 'w') return;
    const movable = (state.legalMoves || []).some(move => move.from === square);
    if (!selected) {
      if (!movable) return;
      selected = square;
      return drawHomeGame();
    }
    if (square === selected) {
      selected = null;
      return drawHomeGame();
    }
    const legal = (state.legalMoves || []).some(move => move.from === selected && move.to === square);
    if (!legal && movable) {
      selected = square;
      return drawHomeGame();
    }
    if (!legal) {
      selected = null;
      return drawHomeGame();
    }
    try {
      state = await api(`/games/${gameId}/move`, {
        method:'POST',
        body:JSON.stringify({ move:{ from:selected, to:square, promotion:'q' } })
      });
    } catch (error) {
      await topAlert(error.message, 'Potez nije odigran');
    }
    selected = null;
    drawHomeGame();
  }

  drawHomeGame();
}

async function friendsPage() {
  if (!me) return view('login');
  let friends = [];
  let challenges = [];
  try {
    [friends, challenges] = await Promise.all([api('/friends'), api('/challenges')]);
  } catch (error) {
    await topAlert(error.message, 'Podaci nisu učitani');
  }

  layout(`
    <div class="grid">
      <section class="card">
        <h1>Prijatelji</h1>
        <form id="search">
          <input name="q" placeholder="Pretraži korisničko ime">
          <button>Pretraži</button>
        </form>
        <div id="results"></div>
        <h3>Izazovi</h3>
        <div id="challenges">
          ${challenges.map(challenge => `
            <p>
              <b>${esc(challenge.challenger)}</b> te izaziva
              <button data-accept="${challenge.id}">Prihvati</button>
              <button data-decline="${challenge.id}">Odbij</button>
            </p>
          `).join('') || '<p class="muted">Nema novih izazova.</p>'}
        </div>
        <h3>Moji prijatelji</h3>
        <div id="friends">
          ${friends.map(friend => `
            <p>
              ${esc(friend.username)}
              ${friend.status === 'accepted' ? `
                <button data-challenge="${friend.id}">Izazovi</button>
                <button data-remove-friend="${friend.id}">Ukloni</button>
                <button data-block-friend="${friend.id}">Blokiraj</button>
              ` : ''}
              ${friend.status === 'pending' && friend.received ? `<button data-friend-accept="${friend.id}">Prihvati zahtev</button>` : ''}
              ${friend.status === 'pending' && !friend.received ? '<span class="muted">Zahtev poslat</span>' : ''}
              ${friend.status === 'blocked' && !friend.received ? `<button data-unblock-friend="${friend.id}">Odblokiraj</button>` : ''}
            </p>
          `).join('') || '<p class="muted">Još nemaš prijatelje.</p>'}
        </div>
      </section>
      <section class="card">
        <h2>Status</h2>
        <form id="status">
          <textarea name="body" maxlength="280" placeholder="Šta ima? (do 280 karaktera)"></textarea>
          <button class="primary">Objavi status</button>
        </form>
        <div class="feed" id="feed"></div>
      </section>
    </div>
  `);

  document.querySelector('#search').onsubmit = async event => {
    event.preventDefault();
    const query = new FormData(event.target).get('q');
    try {
      const results = await api(`/users/search?q=${encodeURIComponent(query)}`);
      document.querySelector('#results').innerHTML = results.map(user => `
        <p>${esc(user.username)} <button data-add="${user.id}">Dodaj</button></p>
      `).join('') || '<p>Nema rezultata.</p>';
      document.querySelectorAll('[data-add]').forEach(button => {
        button.onclick = async () => {
          await api('/friends/request', {
            method: 'POST',
            body: JSON.stringify({ userId: button.dataset.add })
          });
          await topAlert('Zahtev za prijateljstvo je poslat.', 'Zahtev poslat');
        };
      });
    } catch (error) {
      await topAlert(error.message, 'Pretraga nije uspela');
    }
  };

  document.querySelectorAll('[data-challenge]').forEach(button => {
    button.onclick = async () => {
      try {
        await api('/challenges', {
          method: 'POST',
          body: JSON.stringify({ userId: button.dataset.challenge })
        });
        await topAlert('Prijatelj će dobiti obaveštenje o izazovu.', 'Izazov poslat');
      } catch (error) {
        await topAlert(error.message, 'Izazov nije poslat');
      }
    };
  });
  document.querySelectorAll('[data-accept]').forEach(button => {
    button.onclick = async () => {
      try {
        const data = await api(`/challenges/${button.dataset.accept}/respond`, {
          method: 'POST',
          body: JSON.stringify({ status: 'accepted' })
        });
        openGame(data.gameId);
      } catch (error) {
        await topAlert(error.message, 'Izazov nije prihvaćen');
      }
    };
  });
  document.querySelectorAll('[data-decline]').forEach(button => {
    button.onclick = async () => {
      await api(`/challenges/${button.dataset.decline}/respond`, {
        method: 'POST',
        body: JSON.stringify({ status: 'declined' })
      });
      friendsPage();
    };
  });
  document.querySelectorAll('[data-friend-accept]').forEach(button => {
    button.onclick = async () => {
      await api('/friends/respond', {
        method: 'POST',
        body: JSON.stringify({ id: button.dataset.friendAccept, status: 'accepted' })
      });
      friendsPage();
    };
  });
  document.querySelectorAll('[data-remove-friend]').forEach(button => {
    button.onclick = async () => {
      if (!await topConfirm('Ovaj korisnik više neće biti na tvojoj listi prijatelja.', {
        title:'Ukloni prijatelja', confirmText:'Ukloni', danger:true
      })) return;
      await api(`/friends/${button.dataset.removeFriend}`, { method: 'DELETE' });
      friendsPage();
    };
  });
  document.querySelectorAll('[data-block-friend]').forEach(button => {
    button.onclick = async () => {
      if (!await topConfirm('Korisnik neće moći da ti šalje zahteve i izazove.', {
        title:'Blokiraj korisnika', confirmText:'Blokiraj', danger:true
      })) return;
      await api('/friends/block', {
        method: 'POST',
        body: JSON.stringify({ userId: button.dataset.blockFriend })
      });
      friendsPage();
    };
  });
  document.querySelectorAll('[data-unblock-friend]').forEach(button => {
    button.onclick = async () => {
      await api(`/friends/block/${button.dataset.unblockFriend}`, { method: 'DELETE' });
      friendsPage();
    };
  });
  document.querySelector('#status').onsubmit = async event => {
    event.preventDefault();
    try {
      await api('/statuses', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(new FormData(event.target)))
      });
      event.target.reset();
      loadFeed();
    } catch (error) {
      await topAlert(error.message, 'Status nije objavljen');
    }
  };

  const feedElement = document.querySelector('#feed');
  let feedById = new Map();

  feedElement.onclick = async event => {
    const button = event.target.closest('[data-feed-action]');
    const article = event.target.closest('[data-status-id]');
    if (!button || !article) return;
    const id = article.dataset.statusId;
    const status = feedById.get(String(id));
    if (!status) return;

    try {
      if (button.dataset.feedAction === 'like') {
        const result = await api(`/statuses/${id}/like`, { method: 'POST', body: '{}' });
        status.likes = Math.max(0, Number(status.likes) + (result.liked ? 1 : -1));
        button.textContent = `♥ ${status.likes}`;
      }
      if (button.dataset.feedAction === 'edit') {
        const body = (await topPrompt('Tekst statusa', {
          title:'Izmeni status', value:status.body, multiline:true, required:true
        }))?.trim();
        if (!body) return;
        await api(`/statuses/${id}`, { method: 'PATCH', body: JSON.stringify({ body }) });
        status.body = body;
        article.querySelector('[data-status-body]').textContent = body;
      }
      if (button.dataset.feedAction === 'delete') {
        if (!await topConfirm('Obrisani status se ne može vratiti.', {
          title:'Obriši status', confirmText:'Obriši', danger:true
        })) return;
        await api(`/statuses/${id}`, { method: 'DELETE' });
        article.remove();
      }
      if (button.dataset.feedAction === 'reply') {
        const body = (await topPrompt('Odgovor', {
          title:'Odgovori na status', multiline:true, required:true
        }))?.trim();
        if (!body) return;
        await api(`/statuses/${id}/replies`, {
          method: 'POST',
          body: JSON.stringify({ body })
        });
        const replies = await api(`/statuses/${id}/replies`);
        article.querySelector('[data-replies]').innerHTML = replies.map(reply => `
          <p><b>${esc(reply.username)}</b>: ${esc(reply.body)}</p>
        `).join('');
      }
      if (button.dataset.feedAction === 'report') {
        const enteredReason = await topPrompt('Razlog prijave (opciono)', {
          title:'Prijavi status', multiline:true
        });
        if (enteredReason === null) return;
        const reason = enteredReason.trim();
        await api(`/statuses/${id}/report`, {
          method: 'POST',
          body: JSON.stringify({ reason })
        });
        button.textContent = 'Prijavljeno';
        button.disabled = true;
      }
    } catch (error) {
      await topAlert(error.message, 'Radnja nije uspela');
    }
  };

  async function loadFeed() {
    try {
      const feed = await api('/feed');
      feedById = new Map(feed.map(status => [String(status.id), status]));
      feedElement.innerHTML = feed.map(status => `
        <article class="status" data-status-id="${status.id}">
          <b>${esc(status.username)}</b>
          <small> · ${new Date(status.created_at).toLocaleString('sr-RS')}</small>
          <p data-status-body>${esc(status.body)}</p>
          <div class="form-actions social-actions">
            <button data-feed-action="like">♥ ${status.likes}</button>
            <button data-feed-action="reply">Odgovori</button>
            ${status.username === me.username
              ? '<button data-feed-action="edit">Izmeni</button><button data-feed-action="delete">Obriši</button>'
              : '<button data-feed-action="report">Prijavi</button>'}
          </div>
          <div class="replies" data-replies></div>
        </article>
      `).join('') || '<p class="muted">Feed je prazan.</p>';
    } catch (error) {
      feedElement.innerHTML = `<p class="muted">${esc(error.message)}</p>`;
    }
  }
  loadFeed();
}

function createSquare(x, y, piece, selected, onPick, lastMove, legalTargets) {
  const square = document.createElement('div');
  square.className = `sq ${(x + y) % 2 ? 'dark' : 'light'}`;
  square.dataset.file = String.fromCharCode(97 + x);
  square.dataset.rank = String(8 - y);
  square.dataset.square = square.dataset.file + square.dataset.rank;
  if (selected === square.dataset.square) square.classList.add('selected');
  if (lastMove?.from === square.dataset.square || lastMove?.to === square.dataset.square) {
    square.classList.add('last-move');
  }
  if (legalTargets.has(square.dataset.square)) {
    square.classList.add(piece ? 'legal-capture' : 'legal-target');
  }
  if (piece) {
    const color = piece === piece.toUpperCase() ? 'w' : 'b';
    square.innerHTML = `<img class="piece-img" src="/pieces/cburnett/${color}${piece.toUpperCase()}.svg" alt="">`;
  }
  if (legalTargets.has(square.dataset.square)) {
    square.insertAdjacentHTML('beforeend', '<span class="move-hint"></span>');
  }
  square.onclick = () => onPick(square.dataset.square);
  return square;
}

function renderBoard(board, fen, selected, onPick, orientation = 'w', options = {}) {
  board.innerHTML = '';
  const rows = fen.split(' ')[0].split('/');
  const squares = [];
  rows.forEach((row, y) => {
    let x = 0;
    for (const value of row) {
      if (/[1-8]/.test(value)) {
        for (let empty = 0; empty < Number(value); empty += 1) {
          squares.push({ x, y, piece: null });
          x += 1;
        }
      } else {
        squares.push({ x, y, piece: value });
        x += 1;
      }
    }
  });
  if (orientation === 'b') squares.reverse();
  const legalTargets = new Set(options.legalTargets || []);
  squares.forEach(square => {
    board.appendChild(createSquare(square.x, square.y, square.piece, selected, onPick, options.lastMove, legalTargets));
  });
}

function resizeAvatar(file) {
  return new Promise((resolve, reject) => {
    if (!file?.type?.startsWith('image/') || file.size > 5 * 1024 * 1024) {
      return reject(new Error('Izaberi PNG, JPG ili WebP sliku manju od 5 MB.'));
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const size = Math.min(image.naturalWidth, image.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const context = canvas.getContext('2d');
      context.drawImage(
        image,
        (image.naturalWidth - size) / 2,
        (image.naturalHeight - size) / 2,
        size,
        size,
        0,
        0,
        256,
        256
      );
      URL.revokeObjectURL(url);
      let data = canvas.toDataURL('image/webp', 0.82);
      if (data.length > 300000) data = canvas.toDataURL('image/jpeg', 0.72);
      if (data.length > 300000) return reject(new Error('Slika nije mogla dovoljno da se smanji.'));
      resolve(data);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Slika nije mogla da se učita.'));
    };
    image.src = url;
  });
}

async function profilePage() {
  if (!me) return view('login');
  layout(`
    <section class="card">
      <h1>Profil</h1>
      <div class="profile-identity">
        <div class="avatar-editor">
          <span id="profileAvatar" class="profile-avatar">${avatarHtml(me)}</span>
          <label class="upload-button" for="avatarFile">Promeni sliku</label>
          <input id="avatarFile" type="file" accept="image/png,image/jpeg,image/webp" hidden>
          <button id="removeAvatar" type="button">Ukloni sliku</button>
        </div>
        <form id="profileDetails">
          <label>Korisničko ime<input value="${esc(me.username)}" disabled></label>
          <label>Država<input name="country" value="${esc(me.country || '')}" maxlength="80" list="countries" placeholder="Na primer: Srbija"></label>
          <datalist id="countries">
            <option value="Srbija"><option value="Crna Gora"><option value="Bosna i Hercegovina">
            <option value="Hrvatska"><option value="Severna Makedonija"><option value="Slovenija">
          </datalist>
          <label>Biografija<textarea name="bio" maxlength="280" placeholder="Napiši nekoliko reči o sebi">${esc(me.bio || '')}</textarea></label>
          <button class="primary">Sačuvaj profil</button>
          <p id="profileDetailsMessage" class="muted"></p>
        </form>
      </div>
      <div class="section-divider"></div>
      <h2>Sekvence poteza</h2>
      <p class="muted">Unesi dve odvojene sekvence. Potezi moraju biti odigrani tačno prikazanim redom.</p>
      <div class="sequence-grid">
        <section class="sequence-editor">
          <h2>Potezi za bele figure</h2>
          <p class="muted">Odaberi tačno pet poteza belih figura.</p>
          <div id="whiteMovesBoard" class="board profile-board"></div>
          <div id="whiteMovesList" class="moves">Nema unetih poteza.</div>
          <button id="resetWhiteMoves">Poništi bele poteze</button>
          <p id="whiteMovesMessage" class="muted sequence-message"></p>
        </section>
        <section class="sequence-editor">
          <h2>Potezi za crne figure</h2>
          <p class="muted">Odaberi tačno pet poteza crnih figura.</p>
          <div id="blackMovesBoard" class="board profile-board"></div>
          <div id="blackMovesList" class="moves">Nema unetih poteza.</div>
          <button id="resetBlackMoves">Poništi crne poteze</button>
          <p id="blackMovesMessage" class="muted sequence-message"></p>
        </section>
      </div>
      <div class="form-actions profile-actions">
        <button id="saveMoveSequences" class="primary">Sačuvaj obe sekvence</button>
        <button id="changePassword">Promeni lozinku</button>
      </div>
      <p id="profileMessage" class="muted"></p>
    </section>
  `);

  let avatar = me.avatar || '';
  const avatarPreview = document.querySelector('#profileAvatar');
  document.querySelector('#avatarFile').onchange = async event => {
    try {
      avatar = await resizeAvatar(event.target.files[0]);
      avatarPreview.innerHTML = `<img src="${avatar}" alt="Profilna slika">`;
    } catch (error) {
      await topAlert(error.message, 'Slika nije učitana');
    }
  };
  document.querySelector('#removeAvatar').onclick = () => {
    avatar = '';
    avatarPreview.textContent = me.username[0].toUpperCase();
  };
  document.querySelector('#profileDetails').onsubmit = async event => {
    event.preventDefault();
    try {
      const details = Object.fromEntries(new FormData(event.target));
      me = await api('/profile', {
        method:'PATCH',
        body:JSON.stringify({ ...details, avatar })
      });
      localStorage.topUser = JSON.stringify(me);
      updateSidebarUser();
      document.querySelector('#profileDetailsMessage').textContent = 'Profil je sačuvan.';
    } catch (error) {
      document.querySelector('#profileDetailsMessage').textContent = error.message;
    }
  };

  const initialFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  function createSequenceEditor(color) {
    const prefix = color === 'w' ? 'whiteMoves' : 'blackMoves';
    const board = document.querySelector(`#${prefix}Board`);
    const list = document.querySelector(`#${prefix}List`);
    const message = document.querySelector(`#${prefix}Message`);
    let sequence = [];
    let fen = initialFen;
    let selected = null;

    const draw = () => {
      renderBoard(board, fen, selected, pick, color);
      list.innerHTML = sequence.length
        ? sequence.map((move, index) => color === 'w'
          ? `${index + 1}. ${esc(move.san)}`
          : `${index + 1}... ${esc(move.san)}`).join('<br>')
        : 'Nema unetih poteza.';
    };

    async function pick(square) {
      if (sequence.length >= 5) {
        message.textContent = 'Već je uneto pet poteza. Poništi sekvencu da uneseš novu.';
        return;
      }
      if (!selected) {
        selected = square;
        draw();
        return;
      }
      try {
        const data = await api('/profile/secret-moves/validate', {
          method: 'POST',
          body: JSON.stringify({
            color,
            moves: [...sequence, { from: selected, to: square, promotion: 'q' }]
          })
        });
        sequence = data.history;
        fen = data.fen;
        selected = null;
        message.textContent = data.complete ? 'Pet poteza je spremno.' : '';
      } catch (error) {
        selected = null;
        message.textContent = error.message;
      }
      draw();
    }

    async function load(moves) {
      if (!Array.isArray(moves) || !moves.length) return draw();
      const data = await api('/profile/secret-moves/validate', {
        method: 'POST',
        body: JSON.stringify({ color, moves })
      });
      sequence = data.history;
      fen = data.fen;
      message.textContent = sequence.length === 5 ? 'Pet poteza je sačuvano.' : '';
      draw();
    }

    document.querySelector(`#reset${color === 'w' ? 'White' : 'Black'}Moves`).onclick = () => {
      sequence = [];
      fen = initialFen;
      selected = null;
      message.textContent = '';
      draw();
    };
    draw();
    return { getMoves: () => sequence, load };
  }

  const whiteEditor = createSequenceEditor('w');
  const blackEditor = createSequenceEditor('b');

  document.querySelector('#saveMoveSequences').onclick = async () => {
    if (whiteEditor.getMoves().length !== 5 || blackEditor.getMoves().length !== 5) {
      await topAlert('Unesi tačno pet poteza i za bele i za crne figure.', 'Sekvence nisu kompletne');
      return;
    }
    try {
      await api('/profile/secret-moves', {
        method: 'PUT',
        body: JSON.stringify({
          moves: { w: whiteEditor.getMoves(), b: blackEditor.getMoves() }
        })
      });
      document.querySelector('#profileMessage').textContent = 'Potezi za obe boje su sačuvani.';
    } catch (error) {
      await topAlert(error.message, 'Sekvence nisu sačuvane');
    }
  };
  document.querySelector('#changePassword').onclick = async () => {
    const passwords = await topDialog({
      title:'Promeni lozinku',
      fields:[
        { name:'currentPassword', label:'Trenutna lozinka', type:'password', required:true, autocomplete:'current-password' },
        { name:'newPassword', label:'Nova lozinka', type:'password', required:true, minlength:8, autocomplete:'new-password' }
      ],
      confirmText:'Sačuvaj lozinku',
      cancelText:'Odustani'
    });
    if (!passwords) return;
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify(passwords)
      });
      await topAlert('Nova lozinka je sačuvana.', 'Lozinka je promenjena');
    } catch (error) {
      await topAlert(error.message, 'Lozinka nije promenjena');
    }
  };
  try {
    const saved = await api('/profile/secret-moves');
    await Promise.all([
      whiteEditor.load(saved.moves?.w),
      blackEditor.load(saved.moves?.b)
    ]);
  } catch {}
}

async function gamePage(id) {
  if (!id) return view('home');
  let gameId = id;
  layout(`
    <div class="chess">
      <section class="board-column game-board-column">
        <div class="player-bar opponent-bar">
          <span class="player-avatar" id="opponentAvatar">P</span>
          <span><b id="opponentName">Protivnik</b><small id="opponentStatus">povezan</small></span>
          <span class="online-dot"></span>
        </div>
        <div id="board" class="board"></div>
        <div class="player-bar">
          <span class="player-avatar">${avatarHtml(me)}</span>
          <span><b id="playerName">${me ? esc(me.username) : 'Gost'}</b><small>ti</small></span>
        </div>
      </section>
      <aside class="card game-panel">
        <div class="game-panel-title">
          <span class="panel-rook">♜</span>
          <div><h2 id="gameTitle">Partija</h2><small>Bez vremenskog ograničenja</small></div>
        </div>
        <div class="turn-banner" id="turn">Učitavanje…</div>
        <div id="moves" class="moves game-moves"></div>
        <div class="share-game" id="gameShare">
          <span>Kod partije</span>
          <b id="gameCode"></b>
          <button id="copyGame" title="Kopiraj kod">Kopiraj</button>
        </div>
        <div class="form-actions game-actions">
          <button class="danger" id="resign">Predaj partiju</button>
          <button id="drawOffer">Ponudi remi</button>
        </div>
        <section id="messagePanel" hidden>
          <div class="panel-divider"></div>
          <div id="chat">
            <div class="chatlog" id="chatlog"></div>
            <div class="row">
              <input id="chatinput" maxlength="1000" autocomplete="off" placeholder="Napiši poruku">
              <button class="primary" id="send">Pošalji</button>
            </div>
          </div>
        </section>
      </aside>
    </div>
  `);

  try {
    const joined = await api(`/games/${gameId}/join`, { method: 'POST', body: '{}' });
    gameId = joined.id || gameId;
    if (joined.playerId) localStorage.topPlayerId = joined.playerId;
  } catch (error) {
    await topAlert(error.message, 'Ulazak u partiju nije uspeo');
    history.replaceState(null, '', location.pathname);
    return view('home');
  }

  let state;
  try {
    state = await api(`/games/${gameId}`);
  } catch (error) {
    await topAlert(error.message, 'Partija nije učitana');
    return view('home');
  }
  let selected = null;
  const currentPlayerId = () => me?.id || localStorage.topPlayerId;
  const socket = io({
    auth: { playerId: localStorage.topPlayerId || '' }
  });
  activeSocket = socket;
  socket.emit('join-game', gameId);
  document.querySelector('#gameCode').textContent = gameId.slice(0, 8);
  document.querySelector('#copyGame').onclick = async () => {
    try {
      await navigator.clipboard.writeText(gameId.slice(0, 8));
      document.querySelector('#copyGame').textContent = 'Kopirano';
    } catch {
      await topPrompt('Kod partije', {
        title:'Kopiraj kod', value:gameId.slice(0, 8), readonly:true
      });
    }
  };

  function render() {
    const playerId = currentPlayerId();
    const orientation = state.players?.b === playerId ? 'b' : 'w';
    const legalTargets = selected
      ? (state.legalMoves || []).filter(move => move.from === selected).map(move => move.to)
      : [];
    renderBoard(document.querySelector('#board'), state.fen, selected, play, orientation, {
      lastMove:state.lastMove,
      legalTargets
    });
    const turnElement = document.querySelector('#turn');
    turnElement.textContent = state.gameOver
      ? `Partija završena${state.endReason ? ` — ${state.endReason}` : ''}`
      : !state.ready
        ? 'Čeka se protivnik…'
        : state.botThinking
          ? 'TOP Bot razmišlja…'
          : state.turn === orientation
            ? 'Ti si na potezu'
            : `Na potezu je ${state.turn === 'w' ? 'beli' : 'crni'}`;
    turnElement.dataset.state = state.gameOver ? 'ended' : state.turn === orientation ? 'active' : 'waiting';
    const moveRows = [];
    for (let index = 0; index < state.history.length; index += 2) {
      moveRows.push(`
        <div class="move-row">
          <span>${index / 2 + 1}.</span>
          <b>${esc(state.history[index] || '')}</b>
          <b>${esc(state.history[index + 1] || '')}</b>
        </div>
      `);
    }
    document.querySelector('#moves').innerHTML = moveRows.join('') || '<p class="empty-moves">Partija je spremna. Povuci prvi potez.</p>';
    document.querySelector('#gameTitle').textContent = state.bot ? 'Partija protiv TOP Bota' : 'Partija uživo';
    document.querySelector('#opponentName').textContent = state.bot ? (state.botName || 'TOP Bot') : 'Protivnik';
    document.querySelector('#opponentAvatar').textContent = state.bot ? '♞' : 'P';
    document.querySelector('#opponentAvatar').classList.toggle('bot-avatar', Boolean(state.bot));
    document.querySelector('#opponentStatus').textContent = state.bot
      ? state.botThinking ? 'razmišlja…' : 'lagani nivo'
      : state.ready ? 'povezan' : 'čeka se povezivanje';
    document.querySelector('.opponent-bar .online-dot').classList.toggle('offline', !state.ready);
    document.querySelector('#gameShare').hidden = Boolean(state.bot);
    const messagesAvailable = state.chatUnlocked && !state.gameOver;
    document.querySelector('#messagePanel').hidden = !messagesAvailable;
    document.querySelector('#resign').disabled = state.gameOver || !state.ready;
    document.querySelector('#drawOffer').hidden = Boolean(state.bot);
    document.querySelector('#drawOffer').disabled = state.gameOver || !state.ready;
  }

  async function play(square) {
    if (state.gameOver || !state.ready) return;
    if (!selected) {
      selected = square;
      render();
      return;
    }
    try {
      state = await api(`/games/${gameId}/move`, {
        method: 'POST',
        body: JSON.stringify({ move: { from: selected, to: square, promotion: 'q' } })
      });
    } catch (error) {
      await topAlert(error.message, 'Potez nije odigran');
    }
    selected = null;
    render();
  }

  socket.on('state', nextState => {
    state = { ...state, ...nextState };
    selected = null;
    render();
  });
  socket.on('ended', ({ reason } = {}) => {
    state.gameOver = true;
    state.chatUnlocked = false;
    state.endReason = reason || state.endReason;
    render();
  });
  socket.on('draw-offer', async ({ offeredBy } = {}) => {
    if (offeredBy === currentPlayerId()) return;
    if (!await topConfirm('Protivnik nudi da se partija završi nerešeno.', {
      title:'Ponuda remija', confirmText:'Prihvati remi'
    })) {
      await api(`/games/${gameId}/draw-decline`, { method: 'POST', body: '{}' });
      return;
    }
    state = await api(`/games/${gameId}/draw-accept`, { method: 'POST', body: '{}' });
    render();
  });
  socket.on('chat-message', message => {
    const paragraph = document.createElement('p');
    paragraph.textContent = message.text;
    document.querySelector('#chatlog').appendChild(paragraph);
  });

  const sendMessage = () => {
    const input = document.querySelector('#chatinput');
    const text = input.value.trim();
    if (!text) return;
    socket.emit('chat-message', { gameId, text });
    input.value = '';
  };
  document.querySelector('#send').onclick = sendMessage;
  document.querySelector('#chatinput').onkeydown = event => {
    if (event.key === 'Enter') sendMessage();
  };
  document.querySelector('#resign').onclick = async () => {
    if (!await topConfirm('Partija će se odmah završiti pobedom protivnika.', {
      title:'Predaj partiju', confirmText:'Predaj', danger:true
    })) return;
    state = await api(`/games/${gameId}/resign`, { method: 'POST', body: '{}' });
    render();
  };
  document.querySelector('#drawOffer').onclick = async () => {
    await api(`/games/${gameId}/draw-offer`, { method: 'POST', body: '{}' });
    document.querySelector('#drawOffer').textContent = 'Ponuda poslata';
  };
  render();
}

async function boot() {
  localStorage.removeItem('topToken');
  if (me) {
    try {
      me = await api('/me');
      localStorage.topUser = JSON.stringify(me);
    } catch {
      me = null;
      localStorage.removeItem('topUser');
    }
  }
  syncAccountSocket();
  view(location.hash ? 'game' : 'home');
}

window.addEventListener('hashchange', () => view(location.hash ? 'game' : 'home'));
boot();
