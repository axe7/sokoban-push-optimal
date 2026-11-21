// Push-optimal Sokoban solver: each level is a hallway with rooms off it, so it
// solves every room on its own with a breadth-first search over pushes (the
// fewest pushes wins; the walk between pushes is free) and stitches the rooms
// together. A state is the boxes' squares plus the player's reachable region,
// named by its lowest square. Two prunings keep the search small: a box may
// only sit on a live square (one a lone box can be pushed from onto a goal),
// and a box may not join a frozen 2x2 block of walls and boxes off a goal.
// Pure and work-bounded: no clock, no randomness, a fixed state cap per room.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const DIRS = [[0, -1, 'u', 'U'], [0, 1, 'd', 'D'], [-1, 0, 'l', 'L'], [1, 0, 'r', 'R']] as const;
const CAP = 1_000_000;

type Level = { w: number; h: number; wall: Uint8Array; goals: number[]; boxes: number[]; player: number };

function parse(text: string): Level {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goals: number[] = [];
  const boxes: number[] = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!;
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) wall[y * w + x] = 1;
  return { w, h, wall, goals, boxes: boxes.sort((a, b) => a - b), player };
}

// Squares a lone box can be pushed from onto some goal, by pulling back from the goals.
function liveSquares(L: Level): Uint8Array {
  const { w, wall, goals } = L;
  const live = new Uint8Array(wall.length);
  const q = [...goals];
  for (const g of goals) live[g] = 1;
  for (let i = 0; i < q.length; i++) {
    const x = q[i]!;
    for (const [dx, dy] of DIRS) {
      const d = dy * w + dx;
      const y = x - d;
      if (!wall[y] && !wall[y - d] && !live[y]) { live[y] = 1; q.push(y); }
    }
  }
  return live;
}

// Flood-fill the player's region from `from` around walls and boxes; returns its lowest square.
function region(L: Level, occ: Uint8Array, from: number, seen: Int32Array, stamp: number, stack: Int32Array): number {
  const { w, wall } = L;
  let low = from;
  let n = 0;
  stack[n++] = from;
  seen[from] = stamp;
  while (n > 0) {
    const p = stack[--n]!;
    if (p < low) low = p;
    for (let k = 0; k < 4; k++) {
      const q = k === 0 ? p - w : k === 1 ? p + w : k === 2 ? p - 1 : p + 1;
      if (!wall[q] && !occ[q] && seen[q] !== stamp) { seen[q] = stamp; stack[n++] = q; }
    }
  }
  return low;
}

// Whether the box just pushed to `t` is stuck in a 2x2 block of walls and boxes with a box off its goal.
function frozen(L: Level, occ: Uint8Array, goal: Uint8Array, t: number): boolean {
  const { w, wall } = L;
  for (const a of [t, t - 1, t - w, t - w - 1]) {
    const b = a + 1, c = a + w, d = c + 1;
    if (!(wall[a] || occ[a]) || !(wall[b] || occ[b]) || !(wall[c] || occ[c]) || !(wall[d] || occ[d])) continue;
    if ((occ[a] && !goal[a]) || (occ[b] && !goal[b]) || (occ[c] && !goal[c]) || (occ[d] && !goal[d])) return true;
  }
  return false;
}

// Shortest walk from `from` to `to` around walls and boxes, as lower-case LURD letters.
function walkTo(L: Level, occ: Uint8Array, from: number, to: number): string {
  const { w, wall } = L;
  if (from === to) return '';
  const prev = new Int32Array(wall.length).fill(-1);
  const how = new Array<string>(wall.length);
  const q = [from];
  prev[from] = from;
  for (let i = 0; i < q.length; i++) {
    const p = q[i]!;
    if (p === to) break;
    for (const [dx, dy, ch] of DIRS) {
      const s = p + dy * w + dx;
      if (wall[s] || occ[s] || prev[s] !== -1) continue;
      prev[s] = p; how[s] = ch; q.push(s);
    }
  }
  if (prev[to] === -1) throw new Error('walkTo: push square out of reach');
  let s = '';
  for (let p = to; p !== from; p = prev[p]!) s = how[p]! + s;
  return s;
}

function endOf(w: number, from: number, moves: string): number {
  let p = from;
  for (const ch of moves.toLowerCase()) p += ch === 'u' ? -w : ch === 'd' ? w : ch === 'l' ? -1 : 1;
  return p;
}

// Push-optimal solution of one level: {pushes, moves}, or null when the cap runs out.
function solveLevel(L: Level, cap = CAP): { pushes: number; moves: string } | null {
  const { w, wall, goals } = L;
  const size = wall.length;
  const goal = new Uint8Array(size);
  for (const g of goals) goal[g] = 1;
  const live = liveSquares(L);
  if (L.boxes.some((b) => !live[b])) return null;
  const occ = new Uint8Array(size);
  const seen = new Int32Array(size);
  const mark = new Int32Array(size);
  const stack = new Int32Array(size);
  let stamp = 0;
  const solved = (bs: number[]): boolean => bs.every((b) => goal[b]);
  const pack = (bs: number[]): number => { let k = 0; for (let i = bs.length - 1; i >= 0; i--) k = k * size + bs[i]!; return k; };
  const keyOf = (bs: number[], low: number): number => pack(bs) * size + low;
  const bpk: number[] = [pack(L.boxes)];
  const pl: number[] = [L.player];
  const par: number[] = [-1];
  const pf: number[] = [-1];
  const pt: number[] = [-1];
  const index = new Map<number, number>();
  for (const b of L.boxes) occ[b] = 1;
  index.set(keyOf(L.boxes, region(L, occ, L.player, seen, ++stamp, stack)), 0);
  for (const b of L.boxes) occ[b] = 0;
  let found = solved(L.boxes) ? 0 : -1;
  for (let head = 0; found < 0 && head < bpk.length; head++) {
    const boxes = unpack(bpk[head]!, L.boxes.length, size);
    for (const b of boxes) occ[b] = 1;
    region(L, occ, pl[head]!, seen, ++stamp, stack);
    const here = stamp;
    for (let bi = 0; bi < boxes.length && found < 0; bi++) {
      const b = boxes[bi]!;
      for (const [dx, dy] of DIRS) {
        const d = dy * w + dx;
        const t = b + d;
        if (seen[b - d] !== here || wall[t] || occ[t] || !live[t]) continue;
        occ[b] = 0; occ[t] = 1;
        const froze = frozen(L, occ, goal, t);
        let key = -1;
        let next: number[] | null = null;
        if (!froze) {
          next = boxes.slice();
          next[bi] = t;
          next.sort((a, c) => a - c);
          key = keyOf(next, region(L, occ, b, mark, ++stamp, stack));
        }
        occ[t] = 0; occ[b] = 1;
        if (froze || index.has(key)) continue;
        if (bpk.length >= cap) { for (const x of boxes) occ[x] = 0; return null; }
        index.set(key, bpk.length);
        bpk.push(pack(next!));
        pl.push(b);
        par.push(head);
        pf.push(b);
        pt.push(t);
        if (solved(next!)) { found = bpk.length - 1; break; }
      }
    }
    for (const x of boxes) occ[x] = 0;
  }
  if (found < 0) return null;
  const path: number[] = [];
  for (let s = found; s > 0; s = par[s]!) path.push(s);
  path.reverse();
  let moves = '';
  let player = L.player;
  let boxes = L.boxes;
  for (const s of path) {
    const from = pf[s]!, to = pt[s]!;
    const d = to - from;
    const dir = DIRS.find(([dx, dy]) => dy * w + dx === d)!;
    for (const b of boxes) occ[b] = 1;
    moves += walkTo(L, occ, player, from - d);
    for (const b of boxes) occ[b] = 0;
    moves += dir[3];
    player = from;
    boxes = unpack(bpk[s]!, boxes.length, size);
  }
  return { pushes: path.length, moves };
}

function unpack(pk: number, n: number, size: number): number[] {
  const bs: number[] = [];
  for (let i = 0; i < n; i++) { bs.push(pk % size); pk = Math.floor(pk / size); }
  return bs.sort((a, b) => a - b);
}

// The level's rooms: cut the dead squares of the player's row (the hallway: a
// box there reaches no goal) out of the floor; each part left holding a box is
// a room. Null when the level is no set of rooms.
function roomsOf(L: Level): { boxes: number[]; goals: number[] }[] | null {
  const { w, wall, goals, boxes, player } = L;
  const live = liveSquares(L);
  const row = Math.floor(player / w);
  const cut = new Uint8Array(wall.length);
  for (let i = row * w; i < (row + 1) * w; i++) if (!wall[i] && !live[i]) cut[i] = 1;
  if (boxes.some((b) => cut[b])) return null;
  const part = new Int32Array(wall.length).fill(-1);
  const rooms: { boxes: number[]; goals: number[] }[] = [];
  for (let s = 0; s < wall.length; s++) {
    if (wall[s] || cut[s] || part[s] >= 0) continue;
    const squares = [s];
    part[s] = rooms.length;
    for (let i = 0; i < squares.length; i++) {
      for (const [dx, dy] of DIRS) {
        const q = squares[i]! + dy * w + dx;
        if (!wall[q] && !cut[q] && part[q] < 0) { part[q] = rooms.length; squares.push(q); }
      }
    }
    rooms.push({ boxes: [], goals: [] });
  }
  for (const b of boxes) rooms[part[b]!]!.boxes.push(b);
  for (const g of goals) if (part[g]! >= 0) rooms[part[g]!]!.goals.push(g);
  if (goals.some((g) => part[g]! < 0) || rooms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r) => r.boxes.length > 0);
}

// The level solved room by room: each room's push-optimal solution in turn,
// the other rooms' boxes standing as walls (on their goals once done), the
// player walking on from where the last room left it. A box never leaves its
// room, so the rooms' optima add up to the level's.
function solve(text: string): string {
  const L = parse(text);
  const rooms = roomsOf(L);
  if (rooms === null) {
    const whole = solveLevel(L);
    return whole === null ? '' : whole.moves;
  }
  let player = L.player;
  let moves = '';
  for (const room of rooms) {
    const wall = L.wall.slice();
    for (const other of rooms) {
      if (other === room) continue;
      const done = (other as { done?: boolean }).done;
      for (const b of done ? other.goals : other.boxes) wall[b] = 1;
    }
    const sub: Level = { w: L.w, h: L.h, wall, goals: room.goals.slice().sort((a, b) => a - b), boxes: room.boxes.slice().sort((a, b) => a - b), player };
    const solved = solveLevel(sub);
    if (solved === null) return '';
    moves += solved.moves;
    player = endOf(L.w, player, solved.moves);
    (room as { done?: boolean }).done = true;
  }
  return moves;
}

for (const id of readdirSync(I).sort()) {
  const moves = solve(readFileSync(join(I, id, 'level.txt'), 'utf8'));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}
