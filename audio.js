// Música de fundo e efeitos sonoros, sintetizados com a Web Audio API (sem ficheiros).
(() => {
  const PREFS_KEY = 'som';
  let prefs = { music: true, sfx: true };
  try { prefs = Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY)) || {}); } catch {}
  const save = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {} };

  let ctx = null, master, musicBus, sfxBus, delayIn;
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn({ ...prefs }));

  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    // No iPhone, "playback" faz o som tocar mesmo com o botão de silêncio ligado.
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
    ctx = new AC({ latencyHint: 'interactive' });

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    master = ctx.createGain(); master.gain.value = 0.9;
    master.connect(comp).connect(ctx.destination);

    musicBus = ctx.createGain(); musicBus.gain.value = 0;
    musicBus.connect(master);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.8;
    sfxBus.connect(master);

    // Eco suave para a melodia.
    delayIn = ctx.createGain(); delayIn.gain.value = 0.35;
    const delay = ctx.createDelay(1); delay.delayTime.value = 0.56;
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 2200;
    delayIn.connect(delay); delay.connect(tone); tone.connect(fb); fb.connect(delay); tone.connect(musicBus);
  }

  function unlock(e) {
    // Um primeiro toque no próprio botão da música deve só alterná-la.
    if (e && e.target && e.target.closest && e.target.closest('#m-music, #g-music')) return;
    init();
    if (!ctx) return;
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    if (prefs.music) startMusic();
  }
  ['pointerdown', 'touchend', 'keydown'].forEach((ev) =>
    window.addEventListener(ev, unlock, { capture: true, passive: true }));

  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend().catch(() => {});
    else ctx.resume().catch(() => {});
  });

  // ---------- instrumentos ----------
  function env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  function pluck(dest, note, t, { vol = 0.12, decay = 0.5, type = 'sine', echo = false } = {}) {
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = midi(note);
    o2.type = 'sine'; o2.frequency.value = midi(note + 12);
    const g2 = ctx.createGain(); g2.gain.value = 0.18;
    o.connect(g); o2.connect(g2).connect(g); g.connect(dest);
    if (echo) g.connect(delayIn);
    env(g, t, 0.006, vol, decay);
    o.start(t); o2.start(t); o.stop(t + decay + 0.05); o2.stop(t + decay + 0.05);
  }

  function pad(notes, t, dur) {
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 850; f.Q.value = 0.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.9);
    g.gain.setValueAtTime(0.05, t + dur - 0.6);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.4);
    f.connect(g).connect(musicBus);
    for (const n of notes) for (const det of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = 'triangle'; o.frequency.value = midi(n); o.detune.value = det;
      o.connect(f); o.start(t); o.stop(t + dur + 0.5);
    }
  }

  function bass(note, t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = midi(note);
    o.connect(g).connect(musicBus);
    env(g, t, 0.02, 0.16, 0.9);
    o.start(t); o.stop(t + 1);
  }

  let noiseBuf = null;
  function noise() {
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; return s;
  }
  function shaker(t, vol) {
    const s = noise(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'highpass'; f.frequency.value = 7000;
    s.connect(f).connect(g).connect(musicBus);
    env(g, t, 0.004, vol, 0.06);
    s.start(t); s.stop(t + 0.1);
  }

  // ---------- música ----------
  // Progressão calma em Dó: Cmaj9 – Am9 – Fmaj9 – G6, 2 compassos cada, a 84 bpm.
  const CHORDS = [
    { root: 36, pad: [52, 55, 59, 62], scale: [72, 74, 76, 79, 81, 83] },
    { root: 33, pad: [48, 52, 55, 59], scale: [69, 72, 74, 76, 79, 81] },
    { root: 29, pad: [45, 48, 52, 55], scale: [69, 72, 74, 76, 77, 81] },
    { root: 31, pad: [47, 50, 52, 55], scale: [71, 74, 76, 79, 81, 83] },
  ];
  const BPM = 84, EIGHTH = 60 / BPM / 2, BAR = EIGHTH * 8;
  let playing = false, timer = null, nextTime = 0, step = 0, lastNote = 76;

  function scheduleStep(t) {
    const bar = Math.floor(step / 8), inBar = step % 8;
    const chord = CHORDS[Math.floor(bar / 2) % CHORDS.length];
    if (inBar === 0 && bar % 2 === 0) pad(chord.pad, t, BAR * 2);
    if (inBar === 0) bass(chord.root, t);
    if (inBar === 4) bass(chord.root + 7, t);
    if (inBar % 2 === 1) shaker(t, 0.018);

    // Melodia: passos pequenos na escala do acorde, com pausas para respirar.
    const phrase = Math.floor(bar / 4) % 2;
    const density = phrase === 0 ? 0.45 : 0.6;
    if (Math.random() < density && !(inBar === 7 && bar % 2 === 1)) {
      const sc = chord.scale;
      let i = sc.indexOf(sc.reduce((a, b) => Math.abs(b - lastNote) < Math.abs(a - lastNote) ? b : a));
      i = Math.max(0, Math.min(sc.length - 1, i + [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)]));
      lastNote = sc[i];
      pluck(musicBus, lastNote, t, { vol: 0.07, decay: 0.7, type: 'triangle', echo: true });
    }
    step = (step + 1) % (8 * 2 * CHORDS.length * 2);
  }

  function tick() {
    // Depois de uma pausa (app em segundo plano), retoma sem tocar notas atrasadas de rajada.
    if (nextTime < ctx.currentTime - 0.1) nextTime = ctx.currentTime + 0.05;
    while (nextTime < ctx.currentTime + 0.25) {
      scheduleStep(nextTime);
      nextTime += EIGHTH;
    }
  }

  function startMusic() {
    if (!ctx || playing) return;
    playing = true;
    step = 0;
    nextTime = ctx.currentTime + 0.1;
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setTargetAtTime(0.55, ctx.currentTime, 0.6);
    tick();
    timer = setInterval(tick, 60);
  }

  function stopMusic() {
    if (!ctx || !playing) return;
    playing = false;
    clearInterval(timer);
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
  }

  // ---------- efeitos ----------
  function sfx(fn) {
    if (!prefs.sfx) return;
    init();
    if (!ctx) return;
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    fn(ctx.currentTime + 0.01);
  }

  const play = {
    // Acertou à primeira: arpejo brilhante a subir.
    ok: () => sfx((t) => [72, 76, 79, 84].forEach((n, i) => pluck(sfxBus, n, t + i * 0.065, { vol: 0.22, decay: 0.45 }))),
    // 2–3 tentativas: duas notas.
    warn: () => sfx((t) => [72, 79].forEach((n, i) => pluck(sfxBus, n, t + i * 0.09, { vol: 0.2, decay: 0.4 }))),
    // Mais de 3: nota única, mais grave.
    bad: () => sfx((t) => [67, 72].forEach((n, i) => pluck(sfxBus, n, t + i * 0.12, { vol: 0.16, decay: 0.35 }))),
    // Falhou: "bonk" curto a descer.
    wrong: () => sfx((t) => {
      const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = 'square';
      o.frequency.setValueAtTime(220, t);
      o.frequency.exponentialRampToValueAtTime(85, t + 0.2);
      f.type = 'lowpass'; f.frequency.value = 900;
      o.connect(f).connect(g).connect(sfxBus);
      env(g, t, 0.005, 0.2, 0.22);
      o.start(t); o.stop(t + 0.3);
    }),
    // Fim do jogo: pequena fanfarra.
    finish: () => sfx((t) => {
      [60, 64, 67, 72].forEach((n, i) => pluck(sfxBus, n, t + i * 0.11, { vol: 0.2, decay: 0.5 }));
      [72, 76, 79].forEach((n) => pluck(sfxBus, n, t + 0.5, { vol: 0.14, decay: 1.4, type: 'triangle' }));
    }),
    // Toque num botão.
    tap: () => sfx((t) => pluck(sfxBus, 84, t, { vol: 0.06, decay: 0.08 })),
  };

  window.Som = {
    play,
    get prefs() { return { ...prefs }; },
    setMusic(on) {
      prefs.music = on; save();
      if (on) { unlock(); startMusic(); } else stopMusic();
      emit();
    },
    setSfx(on) { prefs.sfx = on; save(); emit(); if (on) play.tap(); },
    onChange(fn) { listeners.add(fn); fn({ ...prefs }); },
  };
})();
