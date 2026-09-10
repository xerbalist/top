const root = document.querySelector('#root');
let me = JSON.parse(localStorage.topUser || 'null');
let activeSocket = null;
let accountSocket = null;

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
  authButton.dataset.view = me ? 'logout' : 'login';
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
    api('/auth/logout', { method: 'POST', body: '{}' }).catch(() => {});
    localStorage.removeItem('topToken');
    localStorage.removeItem('topUser');
    localStorage.removeItem('topPlayerId');
    me = null;
    syncAccountSocket();
    return view('home');
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
      <section class="card mnemonic-modal" role="dialog" aria-modal="true" aria-labelledby="mnemonicTitle">
        <h2 id="mnemonicTitle">Sačuvaj mnemonic frazu</h2>
        <p>Ovo je jedini način za oporavak naloga. Fraza se više neće prikazati.</p>
        <textarea id="mnemonicValue" readonly rows="4">${esc(phrase)}</textarea>
        <div class="form-actions">
          <button id="copyMnemonic">Kopiraj frazu</button>
          <button id="downloadMnemonic">Preuzmi kao .txt</button>
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
      syncAccountSocket();
      if (data.mnemonic) {
        await showMnemonic(data.mnemonic, data.user.username);
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
    <section class="home-chess">
      <div class="board-column home-board-column">
        <div class="player-bar">
          <span class="player-avatar bot-avatar">♞</span>
          <span><b>TOP Bot</b><small>uvek spreman</small></span>
          <span class="online-dot" title="Dostupan"></span>
        </div>
        <div id="homeBoard" class="board preview-board" aria-label="Početna šahovska tabla"></div>
        <div class="player-bar">
          <span class="player-avatar">${me ? esc(me.username[0].toUpperCase()) : 'G'}</span>
          <span><b>${me ? esc(me.username) : 'Gost'}</b><small>${me ? 'spreman za partiju' : 'igraj bez naloga'}</small></span>
        </div>
      </div>
      <div class="card home-actions">
        <span class="eyebrow">DOBRO DOŠAO U TOP</span>
        <h1>Igraj šah.<br><span>Igraj pametno.</span></h1>
        <p class="hero-copy">Brza partija bez sata, protiv prijatelja, anonimnog igrača ili našeg laganog bota.</p>
        <div class="play-options">
          <button class="primary play-option" id="botGame">
            <span class="option-icon">♞</span>
            <span><b>Igraj protiv bota</b><small>Počni odmah kao beli</small></span>
          </button>
          <button class="play-option" id="new">
            <span class="option-icon">♟</span>
            <span><b>Nova partija</b><small>Podeli kod sa protivnikom</small></span>
          </button>
          <button class="play-option subtle" id="join">
            <span class="option-icon">➜</span>
            <span><b>Unesi kod partije</b><small>Pridruži se postojećoj partiji</small></span>
          </button>
        </div>
        <div class="home-note">
          <span class="pulse-dot"></span>
          ${me ? `Prijavljen kao <b>${esc(me.username)}</b>` : 'Registracija nije potrebna za igru'}
        </div>
      </div>
    </section>
  `);

  renderBoard(
    document.querySelector('#homeBoard'),
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    null,
    () => {}
  );

  document.querySelector('#new').onclick = async () => {
    try {
      const data = await api('/games', { method: 'POST', body: '{}' });
      localStorage.topPlayerId = data.playerId;
      openGame(data.id);
    } catch (error) {
      alert(error.message);
    }
  };
  document.querySelector('#botGame').onclick = async () => {
    try {
      const data = await api('/games/bot', { method: 'POST', body: '{}' });
      if (data.playerId) localStorage.topPlayerId = data.playerId;
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

async function profilePage() {
  if (!me) return view('login');
  layout(`
    <section class="card">
      <h1>Profil</h1>
      <p>Korisničko ime: <b>${esc(me.username)}</b></p>
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
      return alert('Unesi tačno pet poteza i za bele i za crne figure.');
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
          <span class="player-avatar">${me ? esc(me.username[0].toUpperCase()) : 'G'}</span>
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
  syncAccountSocket();
  view(location.hash ? 'game' : 'home');
}

window.addEventListener('hashchange', () => view(location.hash ? 'game' : 'home'));
boot();
