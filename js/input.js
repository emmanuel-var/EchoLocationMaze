/**
 * input.js
 * Controles multi-touch usando Pointer Events (estándar web, funciona en
 * Safari iOS, Chrome/Android y escritorio con mouse):
 *
 *  - Joystick virtual (zona inferior izquierda): controla el movimiento
 *    del punto de luz. Solo aparece en dispositivos táctiles (celulares
 *    o tablets); en computadoras con mouse/teclado no se dibuja ni
 *    intercepta clics, porque ahí el movimiento se hace con teclado.
 *  - Cualquier otro toque / clic (o la barra espaciadora / clic con mouse
 *    fuera del joystick): emite un pulso de eco desde la posición actual
 *    del jugador.
 *  - Teclado: WASD / flechas para moverse, Espacio para pulso.
 *
 * Expone window.InputSystem
 */
(function (global) {
  'use strict';

  // Detecta si el dispositivo es táctil (celular/tablet) en vez de una
  // computadora con mouse. Se basa en el tipo de puntero primario y en si
  // el dispositivo tiene "hover" (mouse) disponible; con fallback a
  // ontouchstart/maxTouchPoints para navegadores que no soportan matchMedia.
  function detectTouchDevice() {
    try {
      if (global.matchMedia) {
        const coarse = global.matchMedia('(pointer: coarse)').matches;
        const noHover = global.matchMedia('(hover: none)').matches;
        if (coarse && noHover) return true;
        if (!coarse && !noHover) return false;
      }
    } catch (e) { /* noop */ }
    return ('ontouchstart' in global) || (navigator.maxTouchPoints > 0);
  }

  function createInputSystem(canvas, opts) {
    const onPulseRequested = (opts && opts.onPulseRequested) || function () {};
    const isTouchDevice = detectTouchDevice();

    let joystick = {
      active: false,
      pointerId: null,
      baseX: 0, baseY: 0,
      knobX: 0, knobY: 0,
      radius: 70
    };

    const keys = Object.create(null);
    let moveVec = { x: 0, y: 0 };

    function zoneRadius() {
      return Math.min(140, Math.max(90, canvas.clientWidth * 0.18));
    }

    // Posición fija del joystick (esquina inferior izquierda). Al ser fija
    // y dibujarse siempre, el jugador puede verla desde el inicio en vez
    // de tener que "descubrirla" tocando a ciegas.
    function anchorPos() {
      const r = zoneRadius();
      const margin = Math.max(24, r * 0.35);
      return {
        x: margin + r,
        y: canvas.clientHeight - margin - r
      };
    }

    function inJoystickZone(x, y) {
      if (!isTouchDevice) return false;
      const a = anchorPos();
      const r = zoneRadius();
      const hitR = r * 1.5; // área táctil más amplia que el círculo visual
      return Math.hypot(x - a.x, y - a.y) <= hitR;
    }

    function getPos(e) {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function startJoystick(pointerId) {
      const a = anchorPos();
      joystick.active = true;
      joystick.pointerId = pointerId;
      joystick.radius = zoneRadius();
      joystick.baseX = a.x;
      joystick.baseY = a.y;
      joystick.knobX = a.x;
      joystick.knobY = a.y;
    }

    function updateJoystick(x, y) {
      const dx = x - joystick.baseX;
      const dy = y - joystick.baseY;
      const dist = Math.hypot(dx, dy);
      const r = joystick.radius;
      if (dist <= r) {
        joystick.knobX = x;
        joystick.knobY = y;
      } else {
        joystick.knobX = joystick.baseX + (dx / dist) * r;
        joystick.knobY = joystick.baseY + (dy / dist) * r;
      }
      moveVec.x = (joystick.knobX - joystick.baseX) / r;
      moveVec.y = (joystick.knobY - joystick.baseY) / r;
    }

    function endJoystick() {
      joystick.active = false;
      joystick.pointerId = null;
      moveVec.x = 0;
      moveVec.y = 0;
    }

    function onPointerDown(e) {
      canvas.setPointerCapture && e.pointerId != null && (() => {
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
      })();
      const { x, y } = getPos(e);
      if (!joystick.active && inJoystickZone(x, y)) {
        startJoystick(e.pointerId);
        updateJoystick(x, y);
      } else {
        onPulseRequested();
      }
    }

    function onPointerMove(e) {
      if (joystick.active && e.pointerId === joystick.pointerId) {
        const { x, y } = getPos(e);
        updateJoystick(x, y);
      }
    }

    function onPointerUp(e) {
      if (joystick.active && e.pointerId === joystick.pointerId) {
        endJoystick();
      }
    }

    canvas.addEventListener('pointerdown', onPointerDown, { passive: true });
    canvas.addEventListener('pointermove', onPointerMove, { passive: true });
    canvas.addEventListener('pointerup', onPointerUp, { passive: true });
    canvas.addEventListener('pointercancel', onPointerUp, { passive: true });
    canvas.addEventListener('pointerleave', onPointerUp, { passive: true });

    // Teclado (para pruebas de escritorio)
    global.addEventListener('keydown', (e) => {
      keys[e.code] = true;
      if (e.code === 'Space') onPulseRequested();
    });
    global.addEventListener('keyup', (e) => { keys[e.code] = false; });

    function keyboardVec() {
      let x = 0, y = 0;
      if (keys.ArrowLeft || keys.KeyA) x -= 1;
      if (keys.ArrowRight || keys.KeyD) x += 1;
      if (keys.ArrowUp || keys.KeyW) y -= 1;
      if (keys.ArrowDown || keys.KeyS) y += 1;
      const len = Math.hypot(x, y);
      if (len > 0) { x /= len; y /= len; }
      return { x, y };
    }

    function getMoveVector() {
      if (joystick.active) return { x: moveVec.x, y: moveVec.y };
      return keyboardVec();
    }

    // Dibuja 4 pequeñas flechas (arriba/derecha/abajo/izquierda) dentro del
    // círculo del joystick para dejar claro que sirve para moverse.
    function drawArrowHints(ctx, cx, cy, r) {
      const size = r * 0.13;
      const dist = r * 0.6;
      const dirs = [
        { dx: 0, dy: -1 },
        { dx: 1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: -1, dy: 0 }
      ];
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < dirs.length; i++) {
        const d = dirs[i];
        const px = cx + d.dx * dist;
        const py = cy + d.dy * dist;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(Math.atan2(d.dy, d.dx) + Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(0, -size);
        ctx.lineTo(size * 0.85, size * 0.8);
        ctx.lineTo(-size * 0.85, size * 0.8);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }

    // El joystick solo se dibuja en dispositivos táctiles (celular/tablet).
    // Se muestra siempre en su posición fija para que sea descubrible desde
    // el inicio, no solo mientras se está usando.
    function drawJoystick(ctx) {
      if (!isTouchDevice) return;
      const a = anchorPos();
      const r = zoneRadius();
      const knobX = joystick.active ? joystick.knobX : a.x;
      const knobY = joystick.active ? joystick.knobY : a.y;

      ctx.save();
      ctx.globalAlpha = joystick.active ? 0.4 : 0.22;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
      ctx.stroke();

      if (!joystick.active) {
        ctx.globalAlpha = 0.3;
        drawArrowHints(ctx, a.x, a.y, r);
      }

      ctx.globalAlpha = joystick.active ? 0.65 : 0.32;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(knobX, knobY, r * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    return { getMoveVector, drawJoystick, isTouchDevice };
  }

  global.InputSystem = { create: createInputSystem };
})(window);
