// Short synthesized cues: no third-party assets, downloads or audio requests.
export function watchGameSounds(initial, play) {
  let moves = initial.history?.length || 0;
  let ended = Boolean(initial.gameOver);
  return state => {
    const count = state.history?.length || 0;
    if (!ended && state.gameOver) { ended = true; play('end'); }
    else if (!ended && count > moves) {
      const san = state.history[count - 1] || '';
      play(state.inCheck || /[+#]$/.test(san) ? 'check'
        : san.includes('=') ? 'promotion'
        : san.startsWith('O-O') ? 'castle'
        : san.includes('x') ? 'capture' : 'move');
    }
    moves = Math.max(moves, count);
  };
}

export function createGameSounds() {
  let enabled = true;
  try { enabled = localStorage.getItem('topSoundEnabled') !== 'false'; } catch {}
  let context = null;
  const playing = new Set();
  const stop = () => { for (const tone of playing) { try { tone.stop(); } catch {} } playing.clear(); };
  const unlock = () => {
    if (!enabled) return;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      context ||= new Audio();
      if (context.state === 'suspended') context.resume().catch(() => {});
    } catch { /* Audio failure must never block chess. */ }
  };
  const play = event => {
    if (!enabled || !context || context.state !== 'running' || document.hidden) return;
    const notes = {
      move:[[580,0,0.055]], capture:[[320,0,0.075],[170,0.025,0.085]],
      castle:[[580,0,0.055],[440,0.075,0.055]],
      check:[[740,0,0.10],[880,0.12,0.13]],
      promotion:[[520,0,0.09],[660,0.09,0.09],[780,0.18,0.15]],
      end:[[520,0,0.13],[440,0.14,0.13],[330,0.28,0.22]]
    }[event];
    if (!notes) return;
    stop();
    for (const [frequency, delay, duration] of notes) {
      const oscillator = context.createOscillator(), gain = context.createGain();
      const at = context.currentTime + delay;
      oscillator.type = event === 'move' || event === 'capture' || event === 'castle' ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(frequency, at);
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.12, at + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
      oscillator.connect(gain); gain.connect(context.destination);
      playing.add(oscillator);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); playing.delete(oscillator); };
      oscillator.start(at); oscillator.stop(at + duration + 0.01);
    }
  };
  document.addEventListener('pointerdown', unlock, {passive:true});
  document.addEventListener('keydown', unlock);
  document.addEventListener('visibilitychange', () => { if(document.hidden)stop(); });
  return {
    get enabled() { return enabled; }, play,
    toggle() {
      enabled = !enabled;
      try { localStorage.setItem('topSoundEnabled', String(enabled)); } catch {}
      if (enabled) unlock(); else stop();
      return enabled;
    }
  };
}
