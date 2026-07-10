/**
 * audio.js
 * Todo el audio es sintetizado con Web Audio API (sin archivos externos):
 * esto mantiene el tamaño del juego mínimo y evita descargas de red,
 * algo importante para un juego instantáneo con límite de memoria.
 *
 * Expone window.AudioEngine con:
 *   init()                    -> crea el AudioContext (debe llamarse tras un gesto del usuario)
 *   setMuted(bool) / toggleMuted()
 *   playPing(pitchMul)        -> pulso de eco; el tono sube al acercarte a la salida
 *   playWallTick()            -> tick leve al revelar una pared normal
 *   playDangerReveal()        -> aviso disonante al revelar sombra/trampa/obstáculo
 *   playBump()                -> golpe leve al chocar contra una pared
 *   playTrapHit()             -> sonido áspero al caer en una trampa
 *   playObstacleHit()         -> golpe al chocar con un obstáculo móvil
 *   playKeyPickup()           -> sonido al recoger la llave
 *   playDoorDenied()          -> sonido al tocar la salida sin llave
 *   playChime()               -> melodía al completar el nivel
 *   playGameOver()            -> sonido al quedarte sin energía o ser atrapado
 *   playHeartbeat(intensity)  -> latido tenue de tensión (más rápido cerca de la sombra)
 *   setTensionLevel(0..1)     -> textura continua de tensión ligada a la distancia a la sombra
 *   playUiClick()             -> click leve de interfaz
 */
(function (global) {
  'use strict';

  let ctx = null;
  let masterGain = null;
  let reverbGain = null;
  let convolver = null;
  let ambientNodes = [];
  let tensionGain = null;
  let tensionFilter = null;
  let muted = false;
  let initialized = false;

  function createReverbImpulse(context, seconds, decay) {
    const rate = context.sampleRate;
    const length = Math.max(1, Math.floor(rate * seconds));
    const impulse = context.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return impulse;
  }

  function startAmbient() {
    // Capa 1: zumbido grave (drone) con ligero detune para "batido" orgánico.
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.05;
    droneGain.connect(masterGain);

    const freqs = [55, 55.6, 110];
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = i === 2 ? 'sine' : 'triangle';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = i === 2 ? 0.4 : 0.8;
      osc.connect(g);
      g.connect(droneGain);
      osc.start();
      ambientNodes.push(osc);
    });

    // LFO que modula un filtro paso-bajo para dar movimiento lento a la cueva.
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    droneGain.disconnect();
    droneGain.connect(filter);
    filter.connect(masterGain);

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 250;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();
    ambientNodes.push(lfo);

    // Capa 2: textura de ruido filtrado muy suave (aire de caverna).
    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuffer;
    noiseSrc.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 500;
    noiseFilter.Q.value = 0.6;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.02;
    noiseSrc.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(masterGain);
    noiseSrc.start();
    ambientNodes.push(noiseSrc);

    // Capa 3: textura de tensión (ligada a la cercanía de "la sombra").
    // Silenciosa por defecto; game.js sube su volumen con setTensionLevel().
    const tNoiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const tData = tNoiseBuffer.getChannelData(0);
    for (let i = 0; i < tData.length; i++) tData[i] = Math.random() * 2 - 1;
    const tSrc = ctx.createBufferSource();
    tSrc.buffer = tNoiseBuffer;
    tSrc.loop = true;
    tensionFilter = ctx.createBiquadFilter();
    tensionFilter.type = 'bandpass';
    tensionFilter.frequency.value = 180;
    tensionFilter.Q.value = 1.2;
    tensionGain = ctx.createGain();
    tensionGain.gain.value = 0;
    tSrc.connect(tensionFilter);
    tensionFilter.connect(tensionGain);
    tensionGain.connect(masterGain);
    tSrc.start();
    ambientNodes.push(tSrc);
  }

  function init() {
    if (initialized) return;
    initialized = true;
    const AC = global.AudioContext || global.webkitAudioContext;
    ctx = new AC();

    masterGain = ctx.createGain();
    masterGain.gain.value = muted ? 0 : 0.8;
    masterGain.connect(ctx.destination);

    convolver = ctx.createConvolver();
    convolver.buffer = createReverbImpulse(ctx, 2.2, 2.5);
    reverbGain = ctx.createGain();
    reverbGain.gain.value = 0.5;
    convolver.connect(reverbGain);
    reverbGain.connect(masterGain);

    startAmbient();
  }

  function resumeIfNeeded() {
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  function setMuted(v) {
    muted = v;
    if (masterGain) masterGain.gain.setTargetAtTime(muted ? 0 : 0.8, ctx.currentTime, 0.05);
  }

  function toggleMuted() {
    setMuted(!muted);
    return muted;
  }

  function envGain(startVal, peak, end, t0, attack, release) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(startVal, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(Math.max(end, 0.0001), t0 + attack + release);
    return g;
  }

  // Pulso de eco emitido por el jugador: barrido descendente suave.
  // pitchMul > 1 = tono más agudo (usado cuando la salida está cerca).
  function playPing(pitchMul) {
    if (!ctx) return;
    resumeIfNeeded();
    const mul = pitchMul || 1;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(900 * mul, t0);
    osc.frequency.exponentialRampToValueAtTime(180 * mul, t0 + 0.35);

    const g = envGain(0.0001, 0.35, 0.0001, t0, 0.01, 0.4);
    osc.connect(g);
    g.connect(masterGain);
    g.connect(convolver);
    osc.start(t0);
    osc.stop(t0 + 0.5);
  }

  // Tick leve cuando el pulso revela una pared normal.
  function playWallTick() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 1100 + Math.random() * 300;
    const g = envGain(0.0001, 0.06, 0.0001, t0, 0.002, 0.08);
    osc.connect(g);
    g.connect(masterGain);
    g.connect(convolver);
    osc.start(t0);
    osc.stop(t0 + 0.12);
  }

  // Aviso disonante cuando el pulso revela un peligro (sombra, trampa u obstáculo).
  function playDangerReveal() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    [220, 233.08].forEach((f) => { // intervalo disonante (segunda menor)
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      const g = envGain(0.0001, 0.09, 0.0001, t0, 0.004, 0.22);
      osc.connect(g);
      g.connect(masterGain);
      g.connect(convolver);
      osc.start(t0);
      osc.stop(t0 + 0.3);
    });
  }

  // Golpe sordo leve al chocar físicamente contra una pared.
  function playBump() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, t0);
    osc.frequency.exponentialRampToValueAtTime(70, t0 + 0.12);
    const g = envGain(0.0001, 0.18, 0.0001, t0, 0.005, 0.15);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(t0);
    osc.stop(t0 + 0.2);
  }

  // Melodía ascendente breve al encontrar la salida.
  function playChime() {
    if (!ctx) return;
    resumeIfNeeded();
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      const t0 = ctx.currentTime + i * 0.12;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const g = envGain(0.0001, 0.25, 0.0001, t0, 0.01, 0.5);
      osc.connect(g);
      g.connect(masterGain);
      g.connect(convolver);
      osc.start(t0);
      osc.stop(t0 + 0.6);
    });
  }

  // Sonido áspero al caer en una pared trampa.
  function playTrapHit() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(320, t0);
    osc.frequency.exponentialRampToValueAtTime(60, t0 + 0.35);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1200;
    const g = envGain(0.0001, 0.3, 0.0001, t0, 0.005, 0.4);
    osc.connect(filter);
    filter.connect(g);
    g.connect(masterGain);
    osc.start(t0);
    osc.stop(t0 + 0.5);
  }

  // Golpe al chocar con un obstáculo móvil en la oscuridad.
  function playObstacleHit() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(200, t0);
    osc.frequency.exponentialRampToValueAtTime(90, t0 + 0.18);
    const g = envGain(0.0001, 0.22, 0.0001, t0, 0.004, 0.2);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(t0);
    osc.stop(t0 + 0.28);
  }

  // Sonido brillante al recoger la llave.
  function playKeyPickup() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    [660, 990, 1320].forEach((f, i) => {
      const t = t0 + i * 0.07;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const g = envGain(0.0001, 0.2, 0.0001, t, 0.005, 0.22);
      osc.connect(g);
      g.connect(masterGain);
      g.connect(convolver);
      osc.start(t);
      osc.stop(t + 0.3);
    });
  }

  // Sonido apagado al tocar la salida sin la llave.
  function playDoorDenied() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, t0);
    osc.frequency.exponentialRampToValueAtTime(90, t0 + 0.18);
    const g = envGain(0.0001, 0.14, 0.0001, t0, 0.004, 0.18);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(t0);
    osc.stop(t0 + 0.25);
  }

  // Sonido al perder (energía agotada o atrapado por la sombra).
  function playGameOver() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    [400, 340, 260, 180].forEach((f, i) => {
      const t = t0 + i * 0.16;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      const g = envGain(0.0001, 0.18, 0.0001, t, 0.01, 0.3);
      osc.connect(g);
      g.connect(masterGain);
      g.connect(convolver);
      osc.start(t);
      osc.stop(t + 0.4);
    });
  }

  // Latido tenue de tensión; intensity 0..1 ajusta volumen y tono.
  function playHeartbeat(intensity) {
    if (!ctx) return;
    const amt = Math.max(0, Math.min(1, intensity || 0));
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 70 + amt * 25;
    const g = envGain(0.0001, 0.05 + amt * 0.13, 0.0001, t0, 0.01, 0.18);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(t0);
    osc.stop(t0 + 0.3);
  }

  // Textura continua ligada a la distancia de "la sombra" (0 = lejos, 1 = muy cerca).
  function setTensionLevel(level) {
    if (!ctx || !tensionGain) return;
    const amt = Math.max(0, Math.min(1, level || 0));
    tensionGain.gain.setTargetAtTime(amt * 0.08, ctx.currentTime, 0.4);
    tensionFilter.frequency.setTargetAtTime(140 + amt * 260, ctx.currentTime, 0.4);
  }

  // Click leve de interfaz (botones).
  function playUiClick() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 700;
    const g = envGain(0.0001, 0.05, 0.0001, t0, 0.001, 0.05);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(t0);
    osc.stop(t0 + 0.08);
  }

  global.AudioEngine = {
    init, setMuted, toggleMuted, resumeIfNeeded,
    playPing, playWallTick, playDangerReveal, playBump,
    playTrapHit, playObstacleHit, playKeyPickup, playDoorDenied,
    playChime, playGameOver, playHeartbeat, setTensionLevel,
    playUiClick
  };
})(window);
