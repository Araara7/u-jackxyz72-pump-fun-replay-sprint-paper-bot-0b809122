// Parameter sweep on the full dev window (dataset loaded once).
// Prints cells sorted by net PnL. Pick FLAT regions, never the single best
// cell — the V8 bedah showed no entry filter survives out-of-sample.
import { loadDatasetAll } from './dataset.ts';
import { makeHello, phaseSeed, simulate } from './sim.ts';
import { createStrategy, DEFAULT_PARAMS, type Params } from '../strategy.ts';

const kit = process.argv[2]!;
const ds = loadDatasetAll(kit);
const hello = makeHello(phaseSeed('pilot-pumpfun-replay', 'dev', ds.sha256));
const sol = (x: bigint) => Number(x) / 1e9;

function merge(base: Params, o: any): Params {
  return {
    ...base,
    ...(o.early !== undefined ? { early: { ...base.early, ...o.early } } : {}),
    ...(o.comp !== undefined ? { comp: { ...base.comp, ...o.comp } } : {}),
    ...(Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'early' && k !== 'comp')) as any),
  };
}

const cells: { label: string; o: any }[] = [];
// Baseline (two-mode, window triggers).
cells.push({ label: 'base', o: {} });
// Early stake / creator filter.
for (const s of [0.02, 0.05]) cells.push({ label: `early.stake=${s}`, o: { early: { stakeSol: s } } });
for (const c of [1, 5]) cells.push({ label: `early.creator>=${c}`, o: { early: { minCreatorBuy: c } } });
for (const a of [100, 400]) cells.push({ label: `early.maxAge=${a}`, o: { early: { maxAge: a } } });
// Comp stake / trail / hard stop.
for (const s of [0.05, 0.1, 0.25]) cells.push({ label: `comp.stake=${s}`, o: { comp: { stakeSol: s } } });
for (const t of [0.1, 0.15, 0.3]) cells.push({ label: `comp.trail=${t}`, o: { comp: { trail: t } } });
for (const h of [0.1, 0.25]) cells.push({ label: `comp.hardStop=${h}`, o: { comp: { hardStop: h } } });
// Comp entry band.
for (const r of [20, 50]) cells.push({ label: `comp.minRq=${r}`, o: { comp: { minRqSol: r } } });
// Early exits: tighter trail / harder stop.
for (const t of [0.15, 0.4]) cells.push({ label: `early.trail=${t}`, o: { early: { trail: t } } });
for (const h of [0.15, 0.4]) cells.push({ label: `early.hardStop=${h}`, o: { early: { hardStop: h } } });
// No early mode / no comp mode.
cells.push({ label: 'no-early', o: { early: { minCreatorBuy: 1000 } } });
cells.push({ label: 'no-comp', o: { comp: { minRqSol: 1000 } } });
// Combined: small comp stake + tight trail + tight stop.
cells.push({ label: 'comp-tight', o: { comp: { stakeSol: 0.1, trail: 0.15, hardStop: 0.1 } } });
cells.push({ label: 'comp-tight+early05', o: { comp: { stakeSol: 0.1, trail: 0.15, hardStop: 0.1 }, early: { stakeSol: 0.05 } } });
// Max hold shorter (cut dead time).
cells.push({ label: 'comp.hold750', o: { comp: { maxHold: 750 } } });
cells.push({ label: 'early.hold400', o: { early: { maxHold: 400 } } });

const rows: { label: string; net: number; trips: number; coins: number; wins: number; dd: number }[] = [];
for (const c of cells) {
  const r = simulate(ds, hello, createStrategy(merge(DEFAULT_PARAMS, c.o)));
  rows.push({ label: c.label, net: sol(r.netPnl), trips: r.trips.length, coins: r.mints, wins: r.trips.filter((t) => t.pnl > 0n).length, dd: r.maxDrawdown });
}
rows.sort((a, b) => b.net - a.net);
for (const r of rows) console.log(`${r.label.padEnd(28)} net ${r.net.toFixed(3)}  trips ${r.trips}  wins ${r.wins}  coins ${r.coins}  dd ${r.dd.toFixed(3)}`);
