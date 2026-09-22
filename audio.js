// Música de fundo e efeitos sonoros, sintetizados com a Web Audio API (sem ficheiros).
(() => {
  const PREFS_KEY = 'som';
  let prefs = { music: true, sfx: true };
  try { prefs = Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY)) || {}); } catch {}
  const save = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {} };

  let ctx = null, master, musicBus, sfxBus, reverbIn;
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

    // Reverberação partilhada pela música.
    reverbIn = ctx.createGain(); reverbIn.gain.value = 0.35;
    const verb = makeReverb();
    reverbIn.connect(verb).connect(musicBus);
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

  // Usado pelos efeitos sonoros.
  function pluck(dest, note, t, { vol = 0.12, decay = 0.5, type = 'sine' } = {}) {
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = midi(note);
    o2.type = 'sine'; o2.frequency.value = midi(note + 12);
    const g2 = ctx.createGain(); g2.gain.value = 0.18;
    o.connect(g); o2.connect(g2).connect(g); g.connect(dest);
    env(g, t, 0.006, vol, decay);
    o.start(t); o2.start(t); o.stop(t + decay + 0.05); o2.stop(t + decay + 0.05);
  }

  // Piano suave: quase só a nota pura, com um filtro que fecha à medida que a nota se apaga.
  function keys(note, t, dur, vol) {
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass'; f.Q.value = 0.3;
    f.frequency.setValueAtTime(1800, t);
    f.frequency.exponentialRampToValueAtTime(500, t + dur + 0.8);
    const len = dur + 1.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(vol * 0.45, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    f.connect(g); g.connect(musicBus); g.connect(reverbIn);
    [[1, 1], [2, 0.12], [3, 0.03]].forEach(([mult, amp]) => {
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = 'sine'; o.frequency.value = midi(note) * mult; og.gain.value = amp;
      o.connect(og).connect(f); o.start(t); o.stop(t + len + 0.05);
    });
  }

  // Fundo de acordes, muito suave e abafado.
  function pad(notes, t, dur) {
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass'; f.frequency.value = 520; f.Q.value = 0.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.022, t + 1.2);
    g.gain.setValueAtTime(0.022, t + dur - 0.4);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.8);
    f.connect(g); g.connect(musicBus); g.connect(reverbIn);
    for (const n of notes) {
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = midi(n);
      o.connect(f); o.start(t); o.stop(t + dur + 1);
    }
  }

  // Sala: reverberação gerada (ruído que se apaga), para o som ficar quente e redondo.
  function makeReverb() {
    const len = Math.floor(ctx.sampleRate * 2.6);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let last = 0;
      for (let i = 0; i < len; i++) {
        last = last * 0.6 + (Math.random() * 2 - 1) * 0.4; // ruído já abafado
        d[i] = last * Math.pow(1 - i / len, 3);
      }
    }
    const conv = ctx.createConvolver(); conv.buffer = buf;
    return conv;
  }

  // ---------- música ----------
  // Melodia composta em Dó maior, 72 bpm, 16 compassos (parte A + parte B).
  const BPM = 72, BEAT = 60 / BPM;
  const CH = {
    C:  { bass: 48, pad: [52, 55, 60], arp: [60, 64, 67, 64] },
    Am: { bass: 45, pad: [52, 57, 60], arp: [57, 60, 64, 60] },
    F:  { bass: 41, pad: [53, 57, 60], arp: [57, 60, 65, 60] },
    G:  { bass: 43, pad: [50, 55, 59], arp: [55, 59, 62, 59] },
    Dm: { bass: 50, pad: [50, 53, 57], arp: [57, 62, 65, 62] },
    Em: { bass: 52, pad: [52, 55, 59], arp: [55, 59, 64, 59] },
  };
  const PROG = ['C', 'Am', 'F', 'G', 'C', 'Am', 'Dm', 'G', 'F', 'G', 'Em', 'Am', 'F', 'G', 'C', 'C'];
  // [nota, duração em tempos]; null = pausa
  const MELODY = [
    [[76, 1.5], [74, 0.5], [72, 1], [74, 1]],
    [[76, 2], [72, 1], [69, 1]],
    [[69, 1.5], [72, 0.5], [77, 1], [76, 1]],
    [[74, 3], [null, 1]],
    [[76, 1.5], [74, 0.5], [72, 1], [74, 1]],
    [[76, 1], [79, 1], [81, 2]],
    [[77, 1], [76, 1], [74, 1], [72, 1]],
    [[74, 2], [71, 1], [74, 1]],
    [[72, 1], [77, 1], [81, 1.5], [79, 0.5]],
    [[79, 1], [77, 1], [74, 2]],
    [[76, 1], [79, 1], [83, 1.5], [81, 0.5]],
    [[81, 3], [null, 1]],
    [[81, 1], [79, 1], [77, 1], [76, 1]],
    [[74, 1], [76, 1], [77, 1], [79, 1]],
    [[76, 2], [74, 1], [72, 1]],
    [[72, 3], [null, 1]],
  ];
  const LOOP_BEATS = PROG.length * 4;

  // Lista de eventos de uma volta completa, ordenada no tempo.
  function buildLoop(round) {
    const ev = [];
    PROG.forEach((name, bar) => {
      const c = CH[name], b0 = bar * 4;
      if (bar === 0 || PROG[bar - 1] !== name) {
        let len = 1; while (PROG[bar + len] === name) len++;
        ev.push({ at: b0, fn: (t) => pad(c.pad, t, len * 4 * BEAT) });
      }
      ev.push({ at: b0, fn: (t) => keys(c.bass, t, 1.6 * BEAT, 0.07) });
      ev.push({ at: b0 + 2, fn: (t) => keys(c.bass + 7, t, 1.2 * BEAT, 0.045) });
      c.arp.forEach((n, i) => ev.push({ at: b0 + i + 0.5, fn: (t) => keys(n, t, 0.5 * BEAT, 0.022) }));
      // Na segunda volta, a primeira metade fica só com o acompanhamento, para respirar.
      if (round % 2 === 1 && bar < 8) return;
      let at = b0;
      for (const [n, d] of MELODY[bar]) {
        if (n !== null) { const when = at; ev.push({ at: when, fn: (t) => keys(n, t, d * BEAT, 0.085) }); }
        at += d;
      }
    });
    return ev.sort((a, b) => a.at - b.at);
  }

  let playing = false, timer = null, loopStart = 0, round = 0, events = [], idx = 0;

  function tick() {
    const now = ctx.currentTime;
    // Depois de uma pausa (app em segundo plano), recomeça em vez de tocar notas atrasadas de rajada.
    if (idx < events.length && loopStart + events[idx].at * BEAT < now - 0.2) {
      loopStart = now + 0.1; round = 0; events = buildLoop(round); idx = 0;
    }
    for (;;) {
      if (idx >= events.length) {
        loopStart += LOOP_BEATS * BEAT; round++; events = buildLoop(round); idx = 0;
      }
      const t = loopStart + events[idx].at * BEAT;
      if (t > now + 0.3) break;
      events[idx].fn(t);
      idx++;
    }
  }

  function startMusic() {
    if (!ctx || playing) return;
    playing = true;
    round = 0; events = buildLoop(0); idx = 0;
    loopStart = ctx.currentTime + 0.1;
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setTargetAtTime(0.7, ctx.currentTime, 0.8);
    tick();
    timer = setInterval(tick, 80);
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
