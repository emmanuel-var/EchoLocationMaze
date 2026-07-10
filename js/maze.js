/**
 * maze.js
 * Generación procedural de laberintos "perfectos" (sin ciclos) mediante
 * el algoritmo recursive-backtracker, con semilla para reproducibilidad.
 *
 * Expone window.MazeGen = { generateMaze, mazeToSegments }
 */
(function (global) {
  'use strict';

  // PRNG determinista (mulberry32) — evita depender de Math.random
  // para poder reproducir un nivel si hiciera falta depurar.
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

  /**
   * Genera un laberinto perfecto de cols x rows celdas.
   * Cada celda tiene 4 posibles paredes: top, right, bottom, left.
   */
  function generateMaze(cols, rows, seed) {
    const rand = mulberry32(seed >>> 0);
    const idx = (x, y) => y * cols + x;

    const cells = new Array(cols * rows);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        cells[idx(x, y)] = {
          x, y,
          top: true, right: true, bottom: true, left: true,
          visited: false
        };
      }
    }

    const opposite = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' };

    function unvisitedNeighbors(cell) {
      const list = [];
      const { x, y } = cell;
      if (y > 0) { const n = cells[idx(x, y - 1)]; if (!n.visited) list.push({ cell: n, dir: 'top' }); }
      if (x < cols - 1) { const n = cells[idx(x + 1, y)]; if (!n.visited) list.push({ cell: n, dir: 'right' }); }
      if (y < rows - 1) { const n = cells[idx(x, y + 1)]; if (!n.visited) list.push({ cell: n, dir: 'bottom' }); }
      if (x > 0) { const n = cells[idx(x - 1, y)]; if (!n.visited) list.push({ cell: n, dir: 'left' }); }
      return list;
    }

    const start = cells[idx(0, 0)];
    start.visited = true;
    let current = start;
    let visitedCount = 1;
    const total = cols * rows;
    const stack = [];

    while (visitedCount < total) {
      const options = unvisitedNeighbors(current);
      if (options.length > 0) {
        const choice = options[(rand() * options.length) | 0];
        current[choice.dir] = false;
        choice.cell[opposite[choice.dir]] = false;
        choice.cell.visited = true;
        visitedCount++;
        stack.push(current);
        current = choice.cell;
      } else {
        current = stack.pop();
      }
    }

    return { cols, rows, cells };
  }

  /**
   * Convierte el laberinto en una lista plana de segmentos [x1,y1,x2,y2]
   * en coordenadas de mundo (px), evitando duplicar paredes compartidas:
   * cada celda aporta solo su pared superior e izquierda, más las
   * paredes de borde inferior/derecho del propio perímetro del mapa.
   */
  function mazeToSegments(maze, cellSize) {
    return mazeToSegmentsDetailed(maze, cellSize).map((s) => [s.x1, s.y1, s.x2, s.y2]);
  }

  /**
   * Igual que mazeToSegments pero conserva la celda de origen de cada
   * pared, para poder elegir subconjuntos (p. ej. trampas) evitando
   * zonas concretas del mapa (inicio, salida, llave...).
   */
  function mazeToSegmentsDetailed(maze, cellSize) {
    const { cols, rows, cells } = maze;
    const idx = (x, y) => y * cols + x;
    const segs = [];

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const c = cells[idx(x, y)];
        const x0 = x * cellSize, y0 = y * cellSize;
        const x1 = x0 + cellSize, y1 = y0 + cellSize;
        if (c.top) segs.push({ x1: x0, y1: y0, x2: x1, y2: y0, cellX: x, cellY: y });
        if (c.left) segs.push({ x1: x0, y1: y0, x2: x0, y2: y1, cellX: x, cellY: y });
        if (y === rows - 1 && c.bottom) segs.push({ x1: x0, y1: y1, x2: x1, y2: y1, cellX: x, cellY: y });
        if (x === cols - 1 && c.right) segs.push({ x1: x1, y1: y0, x2: x1, y2: y1, cellX: x, cellY: y });
      }
    }
    return segs;
  }

  function cellOpenNeighbors(maze, x, y) {
    const { cols, rows, cells } = maze;
    const idx = (cx, cy) => cy * cols + cx;
    const c = cells[idx(x, y)];
    const list = [];
    if (!c.top && y > 0) list.push({ x, y: y - 1 });
    if (!c.right && x < cols - 1) list.push({ x: x + 1, y });
    if (!c.bottom && y < rows - 1) list.push({ x, y: y + 1 });
    if (!c.left && x > 0) list.push({ x: x - 1, y });
    return list;
  }

  /** Grado de una celda = número de pasajes abiertos (1 = callejón sin salida). */
  function cellDegree(maze, x, y) {
    return cellOpenNeighbors(maze, x, y).length;
  }

  /** Camino más corto (BFS) entre dos celdas, como lista de {x,y}. */
  function bfsPath(maze, start, goal) {
    const { cols, rows } = maze;
    const idx = (x, y) => y * cols + x;
    const visited = new Uint8Array(cols * rows);
    const prev = new Int32Array(cols * rows).fill(-1);
    const queue = [start];
    visited[idx(start.x, start.y)] = 1;
    let qi = 0;
    while (qi < queue.length) {
      const cur = queue[qi++];
      if (cur.x === goal.x && cur.y === goal.y) break;
      const neighbors = cellOpenNeighbors(maze, cur.x, cur.y);
      for (let i = 0; i < neighbors.length; i++) {
        const n = neighbors[i];
        const ni = idx(n.x, n.y);
        if (!visited[ni]) {
          visited[ni] = 1;
          prev[ni] = idx(cur.x, cur.y);
          queue.push(n);
        }
      }
    }
    const goalIdx = idx(goal.x, goal.y);
    if (!visited[goalIdx]) return null;
    const path = [];
    let cur = goalIdx;
    while (cur !== -1) {
      path.push({ x: cur % cols, y: (cur / cols) | 0 });
      cur = prev[cur];
    }
    path.reverse();
    return path;
  }

  /** Devuelve todas las celdas de grado 1 (callejones sin salida), excluyendo las indicadas. */
  function findDeadEnds(maze, exclude) {
    const { cols, rows } = maze;
    const excludeSet = new Set((exclude || []).map((c) => c.y * cols + c.x));
    const result = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (excludeSet.has(y * cols + x)) continue;
        if (cellDegree(maze, x, y) === 1) result.push({ x, y });
      }
    }
    return result;
  }

  /** Todas las aristas abiertas (para colocar obstáculos que patrullan un tramo recto). */
  function openEdges(maze) {
    const { cols, rows, cells } = maze;
    const idx = (x, y) => y * cols + x;
    const edges = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const c = cells[idx(x, y)];
        if (!c.right && x < cols - 1) edges.push({ a: { x, y }, b: { x: x + 1, y } });
        if (!c.bottom && y < rows - 1) edges.push({ a: { x, y }, b: { x, y: y + 1 } });
      }
    }
    return edges;
  }

  global.MazeGen = {
    generateMaze, mazeToSegments, mazeToSegmentsDetailed,
    cellOpenNeighbors, cellDegree, bfsPath, findDeadEnds, openEdges
  };
})(window);
