// Adds the local anonymous/registered player identity to the game-room join.
// The server still performs the authoritative membership check.
(() => {
  const originalIo = window.io;
  if (!originalIo) return;
  window.io = (...args) => {
    const socket = originalIo(...args);
    const originalEmit = socket.emit.bind(socket);
    socket.emit = (event, ...payload) => {
      if (event === 'join-game' && payload.length === 1) {
        payload.push(localStorage.topPlayerId || '');
      }
      return originalEmit(event, ...payload);
    };
    return socket;
  };
})();
