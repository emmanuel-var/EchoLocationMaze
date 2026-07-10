/**
 * particles.js
 * Sistema de partículas ligero y con memoria acotada: se usa para el
 * pequeño "rebote" de chispas cuando el pulso de eco choca contra una
 * pared. Pool de tamaño fijo (sin asignaciones nuevas en el bucle de
 * juego) para no presionar el recolector de basura en Safari/iOS.
 *
 * Expone window.ParticleSystem
 */
(function (global) {
  'use strict';

  function createParticleSystem(maxParticles) {
    const pool = new Array(maxParticles);
    for (let i = 0; i < maxParticles; i++) {
      pool[i] = { active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 2, color: '255,255,255' };
    }
    let cursor = 0;

    // Emite un pequeño estallido de partículas en (x,y) alejándose en la
    // dirección de la normal de la pared (nx,ny), con un color rgb "r,g,b".
    function burst(x, y, nx, ny, color, count) {
      const n = count || 5;
      for (let i = 0; i < n; i++) {
        const p = pool[cursor];
        cursor = (cursor + 1) % pool.length;
        const spread = (Math.random() - 0.5) * 1.4;
        const speed = 40 + Math.random() * 90;
        const dirx = nx + spread * -ny;
        const diry = ny + spread * nx;
        const len = Math.hypot(dirx, diry) || 1;
        p.active = true;
        p.x = x; p.y = y;
        p.vx = (dirx / len) * speed;
        p.vy = (diry / len) * speed;
        p.maxLife = 0.35 + Math.random() * 0.25;
        p.life = p.maxLife;
        p.size = 1.2 + Math.random() * 1.8;
        p.color = color || '160,210,255';
      }
    }

    function update(dt) {
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        if (!p.active) continue;
        p.life -= dt;
        if (p.life <= 0) { p.active = false; continue; }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.94;
        p.vy *= 0.94;
      }
    }

    function draw(ctx) {
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        if (!p.active) continue;
        const alpha = Math.max(0, p.life / p.maxLife);
        ctx.beginPath();
        ctx.fillStyle = 'rgba(' + p.color + ',' + (alpha * 0.85).toFixed(3) + ')';
        ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    return { burst, update, draw };
  }

  global.ParticleSystem = { create: createParticleSystem };
})(window);
