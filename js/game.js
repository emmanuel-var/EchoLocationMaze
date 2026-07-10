/**
 * game.js
 * Echo Location Maze — bucle principal, física simple, sistema de pulsos
 * de eco, energía finita, perseguidor ("la Sombra"), trampas, llave/puerta,
 * obstáculos móviles y puntuación por estrellas. Solo Canvas 2D (sin WebGL)
 * para mantener el uso de memoria bajo control en Safari/iOS.
 */
(function () {
  'use strict';

  // ---------- Config ----------
  const CELL_SIZE = 70;
  const WALL_THICKNESS = 6;
  const PLAYER_RADIUS = 8;
  const PLAYER_SPEED = 190; // px/s
  const PULSE_SPEED = 480;  // px/s
  const PULSE_MAX_RADIUS = 1400;
  const PULSE_COOLDOWN = 0.55; // segundos
  const FLASH_FADE_TIME = 1.7; // segundos para que un elemento se apague
  const EXIT_RADIUS = 15;
  const KEY_RADIUS = 10;
  const SHADOW_RADIUS = 11;
  const OBSTACLE_RADIUS = 10;
  const MAX_DT = 0.05;

  const MAX_ENERGY = 100;
  const ENERGY_REGEN_PER_SEC = 100 / 42; // se recupera del todo en ~42s sin pulsar
  const TRAP_ENERGY_PENALTY = 14;
  const OBSTACLE_ENERGY_PENALTY = 10;
  const TRAP_IMMUNITY_TIME = 1.1;
  const OBSTACLE_IMMUNITY_TIME = 0.8;

  const SHADOW_GRACE_TIME = 4.5;
  const SHADOW_REPATH_INTERVAL = 1.1;

  // ---------- Canvas ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false });
  let dpr = 1;

  function resizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('orientationchange', resizeCanvas);
  resizeCanvas();

  // ---------- Utilidades ----------
  function closestPointOnSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq > 0 ? ((px - x1) * dx + (py - y1) * dy) / lenSq : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    return [x1 + t * dx, y1 + t * dy];
  }

  function clampInt(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function formatTime(t) {
    const s = Math.max(0, t);
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  // ---------- Puntuación persistida ----------
  function getBestStars(lvl) {
    try {
      const raw = localStorage.getItem('elm_best_stars');
      const map = raw ? JSON.parse(raw) : {};
      return map[lvl] || 0;
    } catch (e) { return 0; }
  }
  function setBestStars(lvl, stars) {
    try {
      const raw = localStorage.getItem('elm_best_stars');
      const map = raw ? JSON.parse(raw) : {};
      if (!map[lvl] || map[lvl] < stars) map[lvl] = stars;
      localStorage.setItem('elm_best_stars', JSON.stringify(map));
      return map[lvl];
    } catch (e) { return stars; }
  }

  // ---------- Construcción de nivel ----------
  let level = 1;
  let world = null; // { cols, rows, cellSize, maze, segments, player, spawn, exit, key, shadow, obstacles, meta }
  const camera = { x: 0, y: 0 };
  const pulses = [];

  function buildLevel(levelNum) {
    const cols = Math.min(9 + levelNum, 24);
    const rows = Math.min(6 + Math.floor(levelNum * 0.7), 16);
    const seed = (levelNum * 7919 + 12345) >>> 0;
    const maze = MazeGen.generateMaze(cols, rows, seed);
    const segsDetailed = MazeGen.mazeToSegmentsDetailed(maze, CELL_SIZE);

    const startCell = { x: 0, y: 0 };
    const exitCell = { x: cols - 1, y: rows - 1 };
    const path = MazeGen.bfsPath(maze, startCell, exitCell) || [startCell, exitCell];

    const placeRand = mulberry32(seed ^ 0x9e3779b9);

    const hasKeyDoor = levelNum >= 2;
    const hasShadow = levelNum >= 2;
    const hasTraps = levelNum >= 3;
    const hasObstacles = levelNum >= 4;

    const excludeCells = new Set([
      startCell.x + ',' + startCell.y,
      exitCell.x + ',' + exitCell.y
    ]);
    if (path.length > 1) excludeCells.add(path[1].x + ',' + path[1].y);

    let keyCell = null;
    if (hasKeyDoor) {
      const deadEnds = MazeGen.findDeadEnds(maze, [startCell, exitCell]);
      keyCell = deadEnds.length
        ? deadEnds[(placeRand() * deadEnds.length) | 0]
        : path[(path.length / 2) | 0];
      excludeCells.add(keyCell.x + ',' + keyCell.y);
    }

    const segments = segsDetailed.map((s) => ({
      x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2,
      flash: 0, trap: false, cellX: s.cellX, cellY: s.cellY
    }));

    if (hasTraps) {
      const candidates = segments.filter((s) => !excludeCells.has(s.cellX + ',' + s.cellY));
      const fraction = Math.min(0.16, 0.06 + levelNum * 0.01);
      const trapCount = Math.min(candidates.length, Math.max(3, Math.floor(candidates.length * fraction)));
      const order = candidates.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        const j = (placeRand() * (i + 1)) | 0;
        const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
      }
      for (let k = 0; k < trapCount; k++) candidates[order[k]].trap = true;
    }

    const obstacles = [];
    if (hasObstacles) {
      const edges = MazeGen.openEdges(maze).filter((e) =>
        !excludeCells.has(e.a.x + ',' + e.a.y) && !excludeCells.has(e.b.x + ',' + e.b.y)
      );
      const wantCount = Math.min(edges.length, 1 + Math.floor(levelNum / 3));
      const pickedIdx = new Set();
      let guard = 0;
      while (pickedIdx.size < wantCount && guard < 300) {
        guard++;
        pickedIdx.add((placeRand() * edges.length) | 0);
      }
      pickedIdx.forEach((i) => {
        const e = edges[i];
        const ax = (e.a.x + 0.5) * CELL_SIZE, ay = (e.a.y + 0.5) * CELL_SIZE;
        const bx = (e.b.x + 0.5) * CELL_SIZE, by = (e.b.y + 0.5) * CELL_SIZE;
        obstacles.push({
          ax, ay, bx, by, x: ax, y: ay,
          phase: placeRand() * Math.PI * 2,
          period: 1.6 + placeRand() * 1.2,
          radius: OBSTACLE_RADIUS,
          flash: 0
        });
      });
    }

    const spawn = { x: CELL_SIZE * 0.5, y: CELL_SIZE * 0.5 };
    const player = { x: spawn.x, y: spawn.y, radius: PLAYER_RADIUS, speed: PLAYER_SPEED };

    const exit = {
      x: (cols - 0.5) * CELL_SIZE, y: (rows - 0.5) * CELL_SIZE,
      radius: EXIT_RADIUS, flash: 0, locked: hasKeyDoor
    };

    const key = keyCell
      ? { x: (keyCell.x + 0.5) * CELL_SIZE, y: (keyCell.y + 0.5) * CELL_SIZE, radius: KEY_RADIUS, collected: false, flash: 0 }
      : null;

    const shadow = hasShadow
      ? {
          x: spawn.x, y: spawn.y, radius: SHADOW_RADIUS, flash: 0,
          active: false, graceTimer: SHADOW_GRACE_TIME,
          speed: PLAYER_SPEED * (0.42 + Math.min(0.18, levelNum * 0.01)),
          repathTimer: 0, waypoints: [], wpIndex: 0
        }
      : null;

    const pathLen = path.length;
    const travelPerCell = CELL_SIZE / PLAYER_SPEED;
    const parPulses = Math.max(3, Math.ceil(pathLen / 3));
    const parTime = Math.round(pathLen * travelPerCell * 1.9 + parPulses * 0.7);
    const energyPerPulse = Math.max(5, Math.min(26, 100 / (parPulses * 1.5)));

    return {
      cols, rows, cellSize: CELL_SIZE, maze, segments, player, spawn, exit, key, shadow, obstacles,
      meta: { hasKeyDoor, hasShadow, hasTraps, hasObstacles, parTime, parPulses, energyPerPulse, pathLen }
    };
  }

  function goToLevel(n) {
    level = n;
    world = buildLevel(level);
    camera.x = world.player.x;
    camera.y = world.player.y;
    document.getElementById('levelLabel').textContent = 'Nivel ' + level;
    updateKeyIcon();
  }

  // ---------- Estado de la partida ----------
  let state = 'start'; // start | playing | levelComplete | paused | gameOver
  let input = null;
  let particles = null;
  let lastTime = null;

  let energy = MAX_ENERGY;
  let elapsedTime = 0;
  let pulsesUsedThisLevel = 0;
  let pulseCooldownTimer = 0;
  let collidingLastFrame = false;
  let bumpCooldown = 0;
  let trapImmunity = 0;
  let obstacleImmunity = 0;
  let denyCooldown = 0;
  let heartbeatTimer = 0;
  let toastTimer = 0;

  let flashOverlay = 0; // destello blanco al completar nivel
  let redFlash = 0;      // destello rojo al recibir daño
  let dangerVignette = 0; // viñeta roja según cercanía de la Sombra

  function resetRunStats() {
    energy = MAX_ENERGY;
    elapsedTime = 0;
    pulsesUsedThisLevel = 0;
    pulseCooldownTimer = 0;
    trapImmunity = 0;
    obstacleImmunity = 0;
    denyCooldown = 0;
    heartbeatTimer = 0;
    flashOverlay = 0;
    redFlash = 0;
    dangerVignette = 0;
    pulses.length = 0;
    AudioEngine.setTensionLevel(0);
    updateHud();
  }

  function showToast(text) {
    const el = document.getElementById('toast');
    el.textContent = text;
    el.classList.add('show');
    toastTimer = 2.4;
  }

  function updateKeyIcon() {
    const el = document.getElementById('keyIcon');
    if (!world || !world.meta.hasKeyDoor) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.classList.toggle('collected', !!(world.key && world.key.collected));
  }

  function updateHud() {
    const pct = clampInt(energy, 0, 100);
    const fill = document.getElementById('energyFill');
    fill.style.width = pct + '%';
    fill.style.background = pct > 50 ? '#5be36a' : (pct > 22 ? '#e8c94a' : '#e0524a');
    document.getElementById('timerLabel').textContent = formatTime(elapsedTime);
    document.getElementById('pulseCountLabel').textContent = 'Ecos: ' + pulsesUsedThisLevel;
    updateKeyIcon();
  }

  // ---------- Colisiones jugador/paredes ----------
  function resolvePlayerCollisions() {
    const player = world.player;
    const segs = world.segments;
    let collided = false;
    const minDist = player.radius + WALL_THICKNESS / 2;

    for (let iter = 0; iter < 3; iter++) {
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        const cp = closestPointOnSegment(player.x, player.y, s.x1, s.y1, s.x2, s.y2);
        const dx = player.x - cp[0];
        const dy = player.y - cp[1];
        const dist = Math.hypot(dx, dy);
        if (dist < minDist) {
          collided = true;
          if (dist < 0.0001) {
            player.x += minDist;
          } else {
            const push = minDist - dist;
            player.x += (dx / dist) * push;
            player.y += (dy / dist) * push;
          }
        }
      }
    }
    return collided;
  }

  function checkTrapCollision() {
    if (!world.meta.hasTraps || trapImmunity > 0) return;
    const player = world.player;
    const threshold = player.radius + WALL_THICKNESS / 2 + 2;
    for (let i = 0; i < world.segments.length; i++) {
      const s = world.segments[i];
      if (!s.trap) continue;
      const cp = closestPointOnSegment(player.x, player.y, s.x1, s.y1, s.x2, s.y2);
      const d = Math.hypot(player.x - cp[0], player.y - cp[1]);
      if (d < threshold) { hitTrap(); return; }
    }
  }

  function hitTrap() {
    energy = Math.max(0, energy - TRAP_ENERGY_PENALTY);
    world.player.x = world.spawn.x;
    world.player.y = world.spawn.y;
    trapImmunity = TRAP_IMMUNITY_TIME;
    redFlash = 1;
    AudioEngine.playTrapHit();
    showToast('¡Trampa! Vuelves al inicio');
    updateHud();
    if (energy <= 0) triggerGameOver('energy');
  }

  function updateObstacles(dt) {
    for (let i = 0; i < world.obstacles.length; i++) {
      const o = world.obstacles[i];
      const t = (Math.sin(((elapsedTime + o.phase) / o.period) * Math.PI * 2) + 1) / 2;
      o.x = o.ax + (o.bx - o.ax) * t;
      o.y = o.ay + (o.by - o.ay) * t;
      if (obstacleImmunity <= 0) {
        const d = Math.hypot(world.player.x - o.x, world.player.y - o.y);
        if (d < world.player.radius + o.radius) { hitObstacle(o); return; }
      }
    }
  }

  function hitObstacle(o) {
    energy = Math.max(0, energy - OBSTACLE_ENERGY_PENALTY);
    const dx = world.player.x - o.x, dy = world.player.y - o.y;
    const dist = Math.hypot(dx, dy) || 1;
    world.player.x += (dx / dist) * 36;
    world.player.y += (dy / dist) * 36;
    obstacleImmunity = OBSTACLE_IMMUNITY_TIME;
    redFlash = 1;
    AudioEngine.playObstacleHit();
    showToast('Chocaste con algo en la oscuridad');
    updateHud();
    if (energy <= 0) triggerGameOver('energy');
  }

  function updateShadow(dt) {
    const sh = world.shadow;
    if (!sh) return;

    if (sh.graceTimer > 0) {
      sh.graceTimer -= dt;
      return;
    }
    sh.active = true;

    sh.repathTimer -= dt;
    if (sh.repathTimer <= 0 || sh.waypoints.length === 0) {
      sh.repathTimer = SHADOW_REPATH_INTERVAL;
      const shCell = {
        x: clampInt(Math.floor(sh.x / CELL_SIZE), 0, world.cols - 1),
        y: clampInt(Math.floor(sh.y / CELL_SIZE), 0, world.rows - 1)
      };
      const playerCell = {
        x: clampInt(Math.floor(world.player.x / CELL_SIZE), 0, world.cols - 1),
        y: clampInt(Math.floor(world.player.y / CELL_SIZE), 0, world.rows - 1)
      };
      const path = MazeGen.bfsPath(world.maze, shCell, playerCell);
      if (path && path.length > 1) {
        sh.waypoints = path.map((c) => ({ x: (c.x + 0.5) * CELL_SIZE, y: (c.y + 0.5) * CELL_SIZE }));
        sh.wpIndex = 1;
      } else {
        sh.waypoints = [];
      }
    }

    if (sh.waypoints.length > 0 && sh.wpIndex < sh.waypoints.length) {
      const wp = sh.waypoints[sh.wpIndex];
      const dx = wp.x - sh.x, dy = wp.y - sh.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 4) {
        sh.wpIndex++;
      } else {
        sh.x += (dx / dist) * sh.speed * dt;
        sh.y += (dy / dist) * sh.speed * dt;
      }
    }

    const distToPlayer = Math.hypot(sh.x - world.player.x, sh.y - world.player.y);
    const proximity = Math.max(0, 1 - distToPlayer / 420);
    AudioEngine.setTensionLevel(proximity);
    dangerVignette = proximity;

    heartbeatTimer -= dt;
    if (heartbeatTimer <= 0) {
      AudioEngine.playHeartbeat(proximity);
      heartbeatTimer = 2.2 - proximity * 1.9;
    }

    if (distToPlayer < world.player.radius + sh.radius) {
      triggerGameOver('shadow');
    }
  }

  // ---------- Pulsos de eco ----------
  function emitPulse() {
    if (!world || state !== 'playing') return;
    if (pulseCooldownTimer > 0 || energy <= 0) return;

    const cost = world.meta.energyPerPulse;
    energy = Math.max(0, energy - cost);
    pulsesUsedThisLevel++;

    pulses.push({ x: world.player.x, y: world.player.y, r: 0, maxR: PULSE_MAX_RADIUS, speed: PULSE_SPEED });
    pulseCooldownTimer = PULSE_COOLDOWN;

    const distToExit = Math.hypot(world.player.x - world.exit.x, world.player.y - world.exit.y);
    const maxDist = Math.hypot(world.cols * CELL_SIZE, world.rows * CELL_SIZE);
    const proximity = 1 - Math.min(1, distToExit / maxDist);

    AudioEngine.resumeIfNeeded();
    AudioEngine.playPing(1 + proximity * 0.6);
    updateHud();

    if (energy <= 0) triggerGameOver('energy');
  }

  function updatePulses(dt) {
    let anyWallHit = false;
    let anyDangerHit = false;

    for (let p = pulses.length - 1; p >= 0; p--) {
      const pulse = pulses[p];
      const prevR = pulse.r;
      pulse.r += pulse.speed * dt;

      for (let i = 0; i < world.segments.length; i++) {
        const s = world.segments[i];
        const cp = closestPointOnSegment(pulse.x, pulse.y, s.x1, s.y1, s.x2, s.y2);
        const d = Math.hypot(pulse.x - cp[0], pulse.y - cp[1]);
        if (d >= prevR && d <= pulse.r) {
          s.flash = 1;
          if (s.trap) anyDangerHit = true; else anyWallHit = true;
          const nx = s.y2 - s.y1, ny = -(s.x2 - s.x1);
          particles.burst(cp[0], cp[1], nx, ny, s.trap ? '255,90,90' : '150,205,255', s.trap ? 7 : 4);
        }
      }

      const exit = world.exit;
      const exitEdgeDist = Math.hypot(pulse.x - exit.x, pulse.y - exit.y) - exit.radius;
      if (exitEdgeDist >= prevR && exitEdgeDist <= pulse.r) { exit.flash = 1; anyWallHit = true; }

      if (world.key && !world.key.collected) {
        const kD = Math.hypot(pulse.x - world.key.x, pulse.y - world.key.y) - world.key.radius;
        if (kD >= prevR && kD <= pulse.r) { world.key.flash = 1; anyWallHit = true; }
      }

      if (world.shadow && world.shadow.active) {
        const shD = Math.hypot(pulse.x - world.shadow.x, pulse.y - world.shadow.y);
        if (shD >= prevR && shD <= pulse.r) { world.shadow.flash = 1; anyDangerHit = true; }
      }

      for (let i = 0; i < world.obstacles.length; i++) {
        const o = world.obstacles[i];
        const oD = Math.hypot(pulse.x - o.x, pulse.y - o.y) - o.radius;
        if (oD >= prevR && oD <= pulse.r) { o.flash = 1; anyDangerHit = true; }
      }

      if (pulse.r > pulse.maxR) pulses.splice(p, 1);
    }

    if (anyDangerHit) AudioEngine.playDangerReveal();
    else if (anyWallHit) AudioEngine.playWallTick();
  }

  function updateFlashDecay(dt) {
    const decay = dt / FLASH_FADE_TIME;
    for (let i = 0; i < world.segments.length; i++) {
      const s = world.segments[i];
      if (s.flash > 0) { s.flash -= decay; if (s.flash < 0) s.flash = 0; }
    }
    if (world.exit.flash > 0) { world.exit.flash -= decay; if (world.exit.flash < 0) world.exit.flash = 0; }
    if (world.key && world.key.flash > 0) { world.key.flash -= decay; if (world.key.flash < 0) world.key.flash = 0; }
    if (world.shadow && world.shadow.flash > 0) {
      world.shadow.flash -= decay * 1.3;
      if (world.shadow.flash < 0) world.shadow.flash = 0;
    }
    for (let i = 0; i < world.obstacles.length; i++) {
      const o = world.obstacles[i];
      if (o.flash > 0) { o.flash -= decay; if (o.flash < 0) o.flash = 0; }
    }
  }

  // ---------- Estrellas / final de nivel ----------
  function computeStars(meta, timeUsed, pulsesUsed) {
    if (timeUsed <= meta.parTime && pulsesUsed <= meta.parPulses) return 3;
    if (timeUsed <= meta.parTime * 1.6 && pulsesUsed <= meta.parPulses * 1.8) return 2;
    return 1;
  }

  function showLevelCompleteOverlay(result) {
    const best = setBestStars(level, result.stars);
    document.getElementById('starsDisplay').textContent = '★'.repeat(result.stars) + '☆'.repeat(3 - result.stars);
    document.getElementById('statsText').textContent =
      'Tiempo: ' + formatTime(result.time) + '   ·   Ecos usados: ' + result.pulses;
    document.getElementById('bestStarsText').textContent = 'Mejor en este nivel: ' + '★'.repeat(best) + '☆'.repeat(3 - best);
    document.getElementById('levelCompleteOverlay').classList.remove('hidden');
  }

  function winLevel() {
    state = 'levelComplete';
    flashOverlay = 1;
    AudioEngine.playChime();
    AudioEngine.setTensionLevel(0);
    const stars = computeStars(world.meta, elapsedTime, pulsesUsedThisLevel);
    showLevelCompleteOverlay({ stars, time: elapsedTime, pulses: pulsesUsedThisLevel });
  }

  function continueToNextLevel() {
    document.getElementById('levelCompleteOverlay').classList.add('hidden');
    goToLevel(level + 1);
    resetRunStats();
    state = 'playing';
  }

  function triggerGameOver(reason) {
    if (state === 'gameOver') return;
    state = 'gameOver';
    AudioEngine.playGameOver();
    AudioEngine.setTensionLevel(0);
    document.getElementById('gameOverMessage').textContent = reason === 'shadow'
      ? 'La sombra te alcanzó en la oscuridad.'
      : 'Te quedaste sin energía. Todo se apaga.';
    document.getElementById('gameOverOverlay').classList.remove('hidden');
  }

  function retryLevel() {
    document.getElementById('gameOverOverlay').classList.add('hidden');
    goToLevel(level);
    resetRunStats();
    state = 'playing';
  }

  // ---------- Bucle principal ----------
  function update(dt) {
    if (toastTimer > 0) {
      toastTimer -= dt;
      if (toastTimer <= 0) document.getElementById('toast').classList.remove('show');
    }
    if (redFlash > 0) redFlash = Math.max(0, redFlash - dt * 2.2);

    if (state === 'start') return;

    if (pulseCooldownTimer > 0) pulseCooldownTimer -= dt;
    if (bumpCooldown > 0) bumpCooldown -= dt;
    if (trapImmunity > 0) trapImmunity -= dt;
    if (obstacleImmunity > 0) obstacleImmunity -= dt;
    if (denyCooldown > 0) denyCooldown -= dt;

    if (state === 'playing') {
      elapsedTime += dt;
      energy = Math.min(MAX_ENERGY, energy + ENERGY_REGEN_PER_SEC * dt);

      const mv = input.getMoveVector();
      world.player.x += mv.x * world.player.speed * dt;
      world.player.y += mv.y * world.player.speed * dt;

      const collided = resolvePlayerCollisions();
      if (collided && !collidingLastFrame && bumpCooldown <= 0) {
        AudioEngine.playBump();
        bumpCooldown = 0.25;
      }
      collidingLastFrame = collided;

      checkTrapCollision();
      updateObstacles(dt);
      updateShadow(dt);
      updatePulses(dt);
      updateFlashDecay(dt);
      particles.update(dt);

      camera.x += (world.player.x - camera.x) * 0.18;
      camera.y += (world.player.y - camera.y) * 0.18;

      if (world.key && !world.key.collected) {
        const dK = Math.hypot(world.player.x - world.key.x, world.player.y - world.key.y);
        if (dK < world.player.radius + world.key.radius) {
          world.key.collected = true;
          world.exit.locked = false;
          AudioEngine.playKeyPickup();
          particles.burst(world.key.x, world.key.y, 0, -1, '120,255,220', 14);
          showToast('Llave recogida — la salida está abierta');
        }
      }

      updateHud();

      const distToExit = Math.hypot(world.player.x - world.exit.x, world.player.y - world.exit.y);
      if (distToExit < world.player.radius + world.exit.radius) {
        if (world.exit.locked) {
          if (denyCooldown <= 0) {
            AudioEngine.playDoorDenied();
            showToast('Necesitas encontrar la llave');
            denyCooldown = 2.2;
          }
        } else {
          winLevel();
        }
      }

      if (energy <= 0 && state === 'playing') triggerGameOver('energy');
    } else if (state === 'levelComplete' || state === 'gameOver') {
      updateFlashDecay(dt);
      updatePulses(dt);
      particles.update(dt);
      if (flashOverlay > 0) flashOverlay = Math.max(0, flashOverlay - dt * 1.6);
    }
  }

  function drawEntityGlow(x, y, radius, color, glow) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, glow);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 16 * glow;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function render() {
    const w = window.innerWidth, h = window.innerHeight;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);

    if (world) {
      ctx.save();
      ctx.translate(w / 2 - camera.x, h / 2 - camera.y);

      // Pulsos (anillos expansivos)
      for (let i = 0; i < pulses.length; i++) {
        const p = pulses[i];
        const alpha = Math.max(0, 1 - p.r / p.maxR) * 0.45;
        if (alpha <= 0.01) continue;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(190,225,255,' + alpha.toFixed(3) + ')';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Paredes reveladas (neón azul/morado; rojo si son trampas)
      for (let i = 0; i < world.segments.length; i++) {
        const s = world.segments[i];
        if (s.flash <= 0.01) continue;
        ctx.save();
        ctx.globalAlpha = Math.min(1, s.flash);
        let strokeColor, glowColor;
        if (s.trap) {
          strokeColor = '#ff5252';
          glowColor = '#ff2b2b';
        } else {
          const g = ctx.createLinearGradient(s.x1, s.y1, s.x2, s.y2);
          g.addColorStop(0, '#7fd8ff');
          g.addColorStop(1, '#b98bff');
          strokeColor = g;
          glowColor = '#9fdcff';
        }
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 3;
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = 12 * s.flash;
        ctx.beginPath();
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
        ctx.stroke();
        ctx.restore();
      }

      // Salida (cerrada = gris; abierta = dorada)
      if (world.exit.flash > 0.01) {
        const e = world.exit;
        ctx.save();
        ctx.globalAlpha = Math.min(1, e.flash);
        const color = e.locked ? '#8a94a8' : '#ffd27a';
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 18 * e.flash;
        ctx.beginPath();
        const r = e.radius;
        ctx.moveTo(e.x, e.y - r);
        ctx.lineTo(e.x + r, e.y);
        ctx.lineTo(e.x, e.y + r);
        ctx.lineTo(e.x - r, e.y);
        ctx.closePath();
        ctx.fill();
        if (e.locked) {
          ctx.strokeStyle = '#ffffff';
          ctx.globalAlpha = Math.min(0.6, e.flash);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(e.x - r * 0.4, e.y);
          ctx.lineTo(e.x + r * 0.4, e.y);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Llave
      if (world.key && !world.key.collected && world.key.flash > 0.01) {
        drawEntityGlow(world.key.x, world.key.y, world.key.radius * 0.6, '#7dffd8', world.key.flash);
        ctx.save();
        ctx.globalAlpha = Math.min(0.7, world.key.flash);
        ctx.strokeStyle = '#7dffd8';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(world.key.x, world.key.y, world.key.radius * 1.6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Obstáculos móviles
      for (let i = 0; i < world.obstacles.length; i++) {
        const o = world.obstacles[i];
        if (o.flash > 0.01) drawEntityGlow(o.x, o.y, o.radius, '#ffb14a', o.flash);
      }

      // La Sombra
      if (world.shadow && world.shadow.flash > 0.01) {
        const sh = world.shadow;
        const jx = (Math.random() - 0.5) * 2.5;
        const jy = (Math.random() - 0.5) * 2.5;
        drawEntityGlow(sh.x + jx, sh.y + jy, sh.radius, '#ff3b3b', sh.flash);
      }

      // Partículas de eco
      particles.draw(ctx);

      // Jugador (punto de luz), siempre visible tenuemente
      const p = world.player;
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 26);
      grad.addColorStop(0, 'rgba(255,255,255,0.55)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 26, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    // Viñeta roja de tensión (cercanía de la Sombra)
    if (dangerVignette > 0.02) {
      ctx.save();
      const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.22, w / 2, h / 2, Math.max(w, h) * 0.72);
      grad.addColorStop(0, 'rgba(255,0,0,0)');
      grad.addColorStop(1, 'rgba(180,0,0,' + (dangerVignette * 0.55).toFixed(3) + ')');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    // Destello rojo de daño
    if (redFlash > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(0.45, redFlash);
      ctx.fillStyle = '#ff2b2b';
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    // Destello blanco de victoria
    if (flashOverlay > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(0.6, flashOverlay);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    if (input) input.drawJoystick(ctx);
  }

  function frame(t) {
    requestAnimationFrame(frame);
    if (document.hidden) { lastTime = null; return; }
    if (lastTime == null) { lastTime = t; return; }
    let dt = (t - lastTime) / 1000;
    lastTime = t;
    if (dt > MAX_DT) dt = MAX_DT;

    if (state !== 'paused') update(dt);
    render();
  }

  // ---------- UI / arranque ----------
  function startGame() {
    AudioEngine.init();
    goToLevel(1);
    resetRunStats();
    state = 'playing';
    document.getElementById('startScreen').classList.add('hidden');
  }

  window.addEventListener('DOMContentLoaded', () => {
    particles = ParticleSystem.create(220);
    input = InputSystem.create(canvas, { onPulseRequested: emitPulse });

    document.getElementById('btnStart').addEventListener('click', startGame);

    const btnMute = document.getElementById('btnMute');
    btnMute.addEventListener('click', () => {
      const muted = AudioEngine.toggleMuted();
      btnMute.textContent = muted ? '🔇' : '🔊';
      AudioEngine.playUiClick();
    });

    const btnPause = document.getElementById('btnPause');
    btnPause.addEventListener('click', () => {
      if (state === 'playing') { state = 'paused'; document.getElementById('pauseOverlay').classList.remove('hidden'); }
      AudioEngine.playUiClick();
    });

    document.getElementById('btnResume').addEventListener('click', () => {
      document.getElementById('pauseOverlay').classList.add('hidden');
      state = 'playing';
      AudioEngine.playUiClick();
    });

    document.getElementById('btnRetry').addEventListener('click', () => {
      retryLevel();
      AudioEngine.playUiClick();
    });

    document.getElementById('btnContinue').addEventListener('click', () => {
      continueToNextLevel();
      AudioEngine.playUiClick();
    });

    requestAnimationFrame(frame);
  });
})();
