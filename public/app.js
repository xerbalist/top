const root = document.querySelector('#root');
let me = JSON.parse(localStorage.topUser || 'null');
let activeSocket = null;

const esc = value => String(value).replace(
  /[&<>"']/g,
  character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]
);

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
  authButton.textContent = me ? 'Odjava' : 'Prijava';
  document.querySelectorAll('[data-view]').forEach(button => {
    button.onclick = () => navigate(button.dataset.view);
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

function view(viewName = 'home') {
  if (viewName === 'logout') {
    api('/auth/logout', { method: 'POST', body: '{}' }).catch(() => {});
    localStorage.removeItem('topToken');
    localStorage.removeItem('topUser');
    localStorage.removeItem('topPlayerId');
    me = null;
    return view('home');
  }
  if (viewName === 'login') return authPage(false);
  if (viewName === 'register') return authPage(true);
  if (viewName === 'friends') return friendsPage();
  if (viewName === 'profile') return profilePage();
  if (viewName === 'game') return gamePage(location.hash.slice(1));
  return homePage();
}

function showMnemonic(phrase) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <section class="card mnemonic-modal" role="dialog" aria-modal="true" aria-labelledby="mnemonicTitle">
        <h2 id="mnemonicTitle">Sačuvaj mnemonic frazu</h2>
        <p>Ovo je jedini način za oporavak naloga. Fraza se više neće prikazati.</p>
        <textarea id="mnemonicValue" readonly rows="4">${esc(phrase)}</textarea>
        <div class="form-actions">
          <button id="copyMnemonic">Kopiraj frazu</button>
        </div>
        <label class="confirm-line">
          <input id="mnemonicSaved" type="checkbox">
          Sačuvao/la sam frazu na sigurnom mestu
        </label>
        <button id="finishRegistration" class="primary" disabled>Nastavi</button>
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
    finish.onclick = () => {
      overlay.remove();
      resolve();
    };
  });
}

function authPage(registering) {
  layout(`
    <section class="card">
      <h1>${registering ? 'Registracija' : 'Prijava'}</h1>
      <form id="auth">
        <input name="username" placeholder="Korisničko ime" required>
        <input name="password" type="password" placeholder="Lozinka" required minlength="8">
        ${registering ? '<p class="muted">Posle registracije dobićeš mnemonic frazu za oporavak naloga.</p>' : ''}
        <button class="primary">${registering ? 'Napravi nalog' : 'Prijavi se'}</button>
      </form>
      <p class="muted">
        ${registering ? 'Već imaš nalog?' : 'Nemaš nalog?'}
        <button id="switch">${registering ? 'Prijava' : 'Registracija'}</button>
      </p>
      ${registering ? '' : '<button id="recover">Oporavak pomoću mnemonic fraze</button>'}
    </section>
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
      if (data.mnemonic) {
        await showMnemonic(data.mnemonic);
      }
      view('home');
    } catch (error) {
      alert(error.message);
    }
  };

  document.querySelector('#recover')?.addEventListener('click', async () => {
    const username = prompt('Korisničko ime');
    const mnemonic = prompt('Mnemonic fraza, tačnim redom');
    const password = prompt('Nova lozinka');
    if (!username || !mnemonic || !password) return;
    try {
      await api('/auth/recover', {
        method: 'POST',
        body: JSON.stringify({ username, mnemonic, password })
      });
      alert('Lozinka je promenjena.');
    } catch (error) {
      alert(error.message);
    }
  });
}

function homePage() {
  layout(`
    <section class="grid">
      <div class="card">
        <h1>TOP ♜</h1>
        <p>Jednostavan šah sa prijateljima.</p>
        <div class="form-actions">
          <button class="primary" id="new">Nova partija</button>
          <button id="join">Pridruži se partiji</button>
        </div>
      </div>
      <div class="card">
        <h2>${me ? `Zdravo, ${esc(me.username)}` : 'Igraj anonimno'}</h2>
        <p class="muted">
          ${me ? 'Poveži se sa prijateljima i objavi status.' : 'Možeš igrati bez registracije.'}
        </p>
      </div>
    </section>
  `);

  document.querySelector('#new').onclick = async () => {
    try {
      const data = await api('/games', { method: 'POST', body: '{}' });
      localStorage.topPlayerId = data.playerId;
      openGame(data.id);
    } catch (error) {
      alert(error.message);
    }
  };
  document.querySelector('#join').onclick = () => {
    const id = prompt('Unesi kod ili ID partije')?.trim();
    if (id) openGame(id);
  };
}

async function friendsPage() {
  if (!me) return view('login');
  let friends = [];
  let challenges = [];
  try {
    [friends, challenges] = await Promise.all([api('/friends'), api('/challenges')]);
  } catch (error) {
    alert(error.message);
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
          alert('Zahtev poslat.');
        };
      });
    } catch (error) {
      alert(error.message);
    }
  };

  document.querySelectorAll('[data-challenge]').forEach(button => {
    button.onclick = async () => {
      try {
        await api('/challenges', {
          method: 'POST',
          body: JSON.stringify({ userId: button.dataset.challenge })
        });
        alert('Izazov poslat.');
      } catch (error) {
        alert(error.message);
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
        alert(error.message);
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
      if (!confirm('Ukloniti prijatelja?')) return;
      await api(`/friends/${button.dataset.removeFriend}`, { method: 'DELETE' });
      friendsPage();
    };
  });
  document.querySelectorAll('[data-block-friend]').forEach(button => {
    button.onclick = async () => {
      if (!confirm('Blokirati ovog korisnika?')) return;
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
      alert(error.message);
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
        const body = prompt('Izmeni status', status.body)?.trim();
        if (!body) return;
        await api(`/statuses/${id}`, { method: 'PATCH', body: JSON.stringify({ body }) });
        status.body = body;
        article.querySelector('[data-status-body]').textContent = body;
      }
      if (button.dataset.feedAction === 'delete') {
        if (!confirm('Obrisati status?')) return;
        await api(`/statuses/${id}`, { method: 'DELETE' });
        article.remove();
      }
      if (button.dataset.feedAction === 'reply') {
        const body = prompt('Napiši odgovor')?.trim();
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
        const reason = prompt('Razlog prijave (opciono)')?.trim() || '';
        await api(`/statuses/${id}/report`, {
          method: 'POST',
          body: JSON.stringify({ reason })
        });
        button.textContent = 'Prijavljeno';
        button.disabled = true;
      }
    } catch (error) {
      alert(error.message);
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

function createSquare(x, y, piece, selected, onPick) {
  const square = document.createElement('div');
  square.className = `sq ${(x + y) % 2 ? 'dark' : 'light'}`;
  square.dataset.file = String.fromCharCode(97 + x);
  square.dataset.rank = String(8 - y);
  square.dataset.square = square.dataset.file + square.dataset.rank;
  if (selected === square.dataset.square) square.classList.add('selected');
  if (piece) {
    const color = piece === piece.toUpperCase() ? 'w' : 'b';
    square.innerHTML = `<img class="piece-img" src="/pieces/cburnett/${color}${piece.toUpperCase()}.svg" alt="">`;
  }
  square.onclick = () => onPick(square.dataset.square);
  return square;
}

function renderBoard(board, fen, selected, onPick, orientation = 'w') {
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
  squares.forEach(square => {
    board.appendChild(createSquare(square.x, square.y, square.piece, selected, onPick));
  });
}

async function profilePage() {
  if (!me) return view('login');
  layout(`
    <section class="card">
      <h1>Profil</h1>
      <p>Korisničko ime: <b>${esc(me.username)}</b></p>
      <h2>Pet poteza</h2>
      <p class="muted">
        Unesi pet svojih poteza iz perspektive belog. Ako igraš crnim,
        potezi se automatski preslikavaju na tvoju stranu table.
      </p>
      <div class="grid">
        <div id="secretBoard" class="board"></div>
        <div>
          <div id="secretMoves" class="moves">Nema unetih poteza.</div>
          <div class="form-actions" style="margin-top:12px">
            <button id="resetSecret">Poništi</button>
            <button id="saveSecret" class="primary">Sačuvaj pet poteza</button>
            <button id="changePassword">Promeni lozinku</button>
          </div>
          <p id="secretMessage" class="muted"></p>
        </div>
      </div>
    </section>
  `);

  const initialFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  let sequence = [];
  let fen = initialFen;
  let selected = null;

  const draw = () => {
    renderBoard(document.querySelector('#secretBoard'), fen, selected, pick);
    document.querySelector('#secretMoves').innerHTML = sequence.length
      ? sequence.map((move, index) => `${index + 1}. ${esc(move.san)}`).join('<br>')
      : 'Nema unetih poteza.';
  };

  async function pick(square) {
    if (!selected) {
      selected = square;
      draw();
      return;
    }
    try {
      const data = await api('/profile/secret-moves/validate', {
        method: 'POST',
        body: JSON.stringify({
          moves: [...sequence, { from: selected, to: square, promotion: 'q' }]
        })
      });
      sequence = data.history;
      fen = data.fen;
      selected = null;
      document.querySelector('#secretMessage').textContent = data.complete
        ? 'Sekvenca je spremna za čuvanje.'
        : '';
    } catch (error) {
      selected = null;
      document.querySelector('#secretMessage').textContent = error.message;
    }
    draw();
  }

  document.querySelector('#resetSecret').onclick = () => {
    sequence = [];
    fen = initialFen;
    selected = null;
    document.querySelector('#secretMessage').textContent = '';
    draw();
  };
  document.querySelector('#saveSecret').onclick = async () => {
    if (sequence.length !== 5) return alert('Unesi tačno pet poteza.');
    try {
      await api('/profile/secret-moves', {
        method: 'PUT',
        body: JSON.stringify({ moves: sequence })
      });
      document.querySelector('#secretMessage').textContent = 'Pet poteza je sačuvano.';
    } catch (error) {
      alert(error.message);
    }
  };
  document.querySelector('#changePassword').onclick = async () => {
    const currentPassword = prompt('Trenutna lozinka');
    const newPassword = prompt('Nova lozinka');
    if (!currentPassword || !newPassword) return;
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword })
      });
      alert('Lozinka je promenjena.');
    } catch (error) {
      alert(error.message);
    }
  };
  draw();
  try {
    const saved = await api('/profile/secret-moves');
    if (saved.moves?.length) {
      const validated = await api('/profile/secret-moves/validate', {
        method: 'POST',
        body: JSON.stringify({ moves: saved.moves })
      });
      sequence = validated.history;
      fen = validated.fen;
      draw();
    }
  } catch {}
}

async function gamePage(id) {
  if (!id) return view('home');
  let gameId = id;
  layout(`
    <div class="chess">
      <section>
        <div id="board" class="board"></div>
        <div class="card game-controls">
          <b id="turn">Učitavanje…</b>
          <p class="muted">Kod partije: <b id="gameCode"></b> <button id="copyGame">Kopiraj</button></p>
          <div id="moves" class="moves"></div>
          <div class="form-actions">
            <button class="danger" id="resign">Predaj partiju</button>
            <button id="drawOffer">Ponudi remi</button>
          </div>
        </div>
      </section>
      <aside class="card" id="messagePanel" hidden>
        <div id="chat">
          <div class="chatlog" id="chatlog"></div>
          <div class="row">
            <input id="chatinput" maxlength="1000" autocomplete="off" placeholder="Napiši poruku">
            <button id="send">Pošalji</button>
          </div>
        </div>
      </aside>
    </div>
  `);

  try {
    const joined = await api(`/games/${gameId}/join`, { method: 'POST', body: '{}' });
    gameId = joined.id || gameId;
    if (joined.playerId) localStorage.topPlayerId = joined.playerId;
  } catch (error) {
    alert(error.message);
    history.replaceState(null, '', location.pathname);
    return view('home');
  }

  let state;
  try {
    state = await api(`/games/${gameId}`);
  } catch (error) {
    alert(error.message);
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
      prompt('Kopiraj kod partije', gameId.slice(0, 8));
    }
  };

  function render() {
    const playerId = currentPlayerId();
    const orientation = state.players?.b === playerId ? 'b' : 'w';
    renderBoard(document.querySelector('#board'), state.fen, selected, play, orientation);
    document.querySelector('#turn').textContent = state.gameOver
      ? `Partija završena${state.endReason ? ` — ${state.endReason}` : ''}`
      : !state.ready
        ? 'Čeka se protivnik…'
      : `Na potezu je ${state.turn === 'w' ? 'beli' : 'crni'}`;
    document.querySelector('#moves').textContent = state.history.join(' · ') || 'Još nema poteza.';
    const messagesAvailable = state.chatUnlocked && !state.gameOver;
    document.querySelector('#messagePanel').hidden = !messagesAvailable;
    document.querySelector('#resign').disabled = state.gameOver || !state.ready;
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
      alert(error.message);
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
    if (!confirm('Protivnik nudi remi. Prihvati?')) {
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
    if (!confirm('Da li sigurno predaješ partiju?')) return;
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
  view(location.hash ? 'game' : 'home');
}

window.addEventListener('hashchange', () => view(location.hash ? 'game' : 'home'));
boot();
