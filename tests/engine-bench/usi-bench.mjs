// KIF-020 engine benchmark harness. Manual tool, NOT run by CI or test:unit.
// Contains no third-party code: engines are separate USI processes built outside
// the repository (see README.md). Every engine move is validated against
// kifu-rival's own legalMoves, and every result is decided by kifu-rival's playMove.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { initialGame, legalMoves, playMove, usi, chooseRivalMove, checkDeclaration } from "../../.sites-runtime/engine-bench/shogi.mjs";

class Engine {
  constructor(name, cmd, options = {}, init = []) {
    this.name = name; this.lines = []; this.waiters = [];
    this.proc = spawn(cmd, [], { stdio: ["pipe", "pipe", "ignore"] });
    let buf = "";
    this.proc.stdout.on("data", d => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); this.onLine(line); } });
    this.options = options; this.init = init;
  }
  onLine(line) { this.lines.push(line); for (const w of [...this.waiters]) if (w.re.test(line)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.resolve(line); } }
  send(s) { this.proc.stdin.write(s + "\n"); }
  wait(re, ms = 120000) { return new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error(`${this.name}: timeout waiting ${re}`)), ms); this.waiters.push({ re, resolve: v => { clearTimeout(t); resolve(v); } }); }); }
  async start() {
    const t0 = Date.now();
    this.send("usi"); await this.wait(/^usiok/);
    for (const c of this.init) this.send(c);
    for (const [k, v] of Object.entries(this.options)) this.send(`setoption name ${k} value ${v}`);
    this.send("isready"); await this.wait(/^readyok/, 300000);
    this.readyMs = Date.now() - t0;
    return this;
  }
  async go(moves, movetime) {
    this.lines = [];
    this.send("usinewgame");
    this.send(`position startpos${moves.length ? " moves " + moves.join(" ") : ""}`);
    const t0 = Date.now();
    this.send(`go movetime ${movetime}`);
    const best = await this.wait(/^bestmove/);
    const infos = this.lines.filter(l => l.startsWith("info") && / nodes /.test(l));
    const last = infos[infos.length - 1] || "";
    const num = k => { const m = last.match(new RegExp(` ${k} (-?\\d+)`)); return m ? Number(m[1]) : undefined; };
    return { move: best.split(/\s+/)[1], ms: Date.now() - t0, depth: num("depth"), nodes: num("nodes"), nps: num("nps") };
  }
  peakRssMB() { try { const s = readFileSync(`/proc/${this.proc.pid}/status`, "utf8"); return Math.round(Number(s.match(/VmHWM:\s+(\d+)/)[1]) / 1024); } catch { return undefined; } }
  quit() { this.send("quit"); setTimeout(() => this.proc.kill(), 500); }
}

const lv4 = { name: "kifu-Lv4", async go(game) { const t0 = Date.now(); const m = chooseRivalMove(game, 4); return { move: m ? usi(m) : "resign", ms: Date.now() - t0 }; } };

async function playGame(black, white, opening, movetime, maxPlies) {
  let game = initialGame(); const moves = []; const stats = { [black.name]: [], [white.name]: [] };
  const apply = (notation, who) => {
    const legal = legalMoves(game).find(m => usi(m) === notation);
    if (!legal) return `illegal:${who}:${notation}`;
    game = playMove(game, legal); moves.push(notation); return null;
  };
  for (const m of opening) { const err = apply(m, "opening"); if (err) return { result: err, moves }; }
  while (game.result === "playing" && moves.length < maxPlies) {
    const player = game.turn === "black" ? black : white;
    const r = player instanceof Engine ? await player.go(moves, movetime) : await player.go(game);
    stats[player.name].push(r);
    if (r.move === "resign") return { result: game.turn === "black" ? "white" : "black", reason: `${player.name} resigned`, moves, stats };
    if (r.move === "win") {
      const d = checkDeclaration(game, game.turn, "amateur27");
      return { result: d.outcome === "win" ? game.turn : (game.turn === "black" ? "white" : "black"), reason: `${player.name} declared (${d.points}pts, amateur27 ${d.outcome})`, moves, stats };
    }
    const err = apply(r.move, player.name);
    if (err) return { result: err, moves, stats };
  }
  return { result: game.result === "playing" ? "draw-cap" : game.result, reason: game.result === "playing" ? `cap ${maxPlies}` : "rules", moves, stats };
}

export async function match(a, b, { games, movetime, openings, maxPlies = 320, log = () => {} }) {
  const score = { [a.name]: 0, [b.name]: 0, draws: 0, other: [] }; const rows = [];
  for (let i = 0; i < games; i++) {
    const [black, white] = i % 2 === 0 ? [a, b] : [b, a];
    const opening = openings[Math.floor(i / 2) % openings.length];
    const g = await playGame(black, white, opening, movetime, maxPlies);
    if (g.result === "black") score[black.name]++; else if (g.result === "white") score[white.name]++;
    else if (g.result.startsWith("draw")) score.draws++; else score.other.push(g.result);
    rows.push({ i, black: black.name, white: white.name, result: g.result, reason: g.reason, plies: g.moves.length, stats: g.stats });
    log(`game ${i + 1}/${games}: ${black.name}(▲) vs ${white.name}(△) -> ${g.result} [${g.reason}] ${g.moves.length} plies`);
  }
  return { score, rows };
}

export { Engine, lv4, playGame };
