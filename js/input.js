/**
 * input.js
 * Controles multi-touch usando Pointer Events (estándar web, funciona en
 * Safari iOS, Chrome/Android y escritorio con mouse):
 *
 *  - Joystick virtual (zona inferior izquierda): controla el movimiento
 *    del punto de luz. Aparece solo mientras se usa.
 *  - Cualquier otro toque / clic (o la barra espaciadora / clic con mouse
 *    fuera del joystick): emite un pulso de eco desde la posición actual
 *    del jugador.
 *  - Teclado: WASD / flechas para moverse, Espacio para pulso.
 *
 * Expone window.InputSystem
 */
(function (global) {
  'use strict';

  function createInputSystem(canvas, opts) {
    const onPulseRequested = (opts && opts.onPulseRequested) || function () {};

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

    function inJoystickZone(x, y) {
      const r = zoneRadius();
      const margin = r * 1.4;
      return x < margin + 20 && y > canvas.clientHeight - margin - 20;
    }

    function getPos(e) {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function startJoystick(x, y, pointerId) {
      joystick.active = true;
      joystick.pointerId = pointerId;
      joystick.radius = zoneRadius();
      joystick.baseX = x;
      joystick.baseY = y;
      joystick.knobX = x;
      joystick.knobY = y;
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
        startJoystick(x, y, e.pointerId);
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

    function drawJoystick(ctx) {
      if (!joystick.active) return;
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(joystick.baseX, joystick.baseY, joystick.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(joystick.knobX, joystick.knobY, joystick.radius * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    return { getMoveVector, drawJoystick };
  }

  global.InputSystem = { create: createInputSystem };
})(window);
