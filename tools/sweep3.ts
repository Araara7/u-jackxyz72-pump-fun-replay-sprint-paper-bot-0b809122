// Third sweep: creator>=5 was the strongest filter. Combine it with sizing,
// buyer count, age, and exit variants. Early-only (comp still off).
import { loadDatasetAll } from './dataset.ts';
import { makeHello, phaseSeed, simulate } from './sim.ts';
import { createStrategy, DEFAULT_PARAMS, type Params } from '../strategy.ts';

const kit = process.argv[2]!;
const dsAll = loadDatasetAll(kit);
const ds0 = loadDatasetAll(kit, 0);
const hello = makeHello(phaseSeed('pilot-pumpfun-replay', 'dev', dsAll.sha256));
const sol = (x: bigint) => Number(x) / 1e9;

function merge(base: Params, o: any): Params {
  return {
    ...base,
    ...(o.early !== undefined ? { early: { ...base.early, ...o.early } } : {}),
    ...(o.comp !== undefined ? { comp: { ...base.comp, ...o.comp } } : {}),
    ...(Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'early' && k !== 'comp')) as any),
  };
}
const OFF = { comp: { minRqSol: 1000 } };
const E5 = { ...OFF, early: { minCreatorBuy: 5 } };
const cells: { label: string; o: any }[] = [];
cells.push({ label: 'creator>=5 base', o: E5 });
for (const c of [8, 10, 3]) cells.push({ label: `creator>=${c}`, o: { ...OFF, early: { minCreatorBuy: c } } });
for (const s of [0.01, 0.02, 0.05]) cells.push({ label: `c5 stake=${s}`, o: { ...E5, early: { ...E5.early, stakeSol: s } } });
for (const b of [4, 8]) cells.push({ label: `c5 buyers=${b}`, o: { ...E5, early: { ...E5.early, minBuyers: b } } });
for (const a of [50, 200, 400]) cells.push({ label: `c5 maxAge=${a}`, o: { ...E5, early: { ...E5.early, maxAge: a } } });
for (const t of [0.15, 0.4]) cells.push({ label: `c5 trail=${t}`, o: { ...E5, early: { ...E5.early, trail: t } } });
for (const h of [400, 1500]) cells.push({ label: `c5 hold=${h}`, o: { ...E5, early: { ...E5.early, maxHold: h } } });
cells.push({ label: 'c5 no-rungs', o: { ...E5, early: { ...E5.early, rungs: [] } } });
cells.push({ label: 'c5 rungs+25/+50', o: { ...E5, early: { ...E5.early, rungs: [[0.25, 0.25], [0.5, 0.25]] } } });
cells.push({ label: 'c5 stake01+buyers8', o: { ...E5, early: { ...E5.early, stakeSol: 0.01, minBuyers: 8 } } });
cells.push({ label: 'c5 stake01+age50', o: { ...E5, early: { ...E5.early, stakeSol: 0.01, maxAge: 50 } } });
cells.push({ label: 'c5 stake02+buyers8', o: { ...E5, early: { ...E5.early, stakeSol: 0.02, minBuyers: 8 } } });

const rows: any[] = [];
for (const c of cells) {
  const params = merge(DEFAULT_PARAMS, c.o);
  const r = simulate(dsAll, hello, createStrategy(params));
  const r0 = simulate(ds0, hello, createStrategy(params));
  rows.push({ label: c.label, net: sol(r.netPnl), net0: sol(r0.netPnl), trips: r.trips.length, wins: r.trips.filter((t) => t.pnl > 0n).length, coins: r.mints, dd: r.maxDrawdown });
}
rows.sort((a, b) => b.net - a.net);
for (const r of rows) console.log(`${r.label.padEnd(24)} net ${r.net.toFixed(3)} (part0 ${r.net0.toFixed(3)})  trips ${r.trips}  wins ${r.wins}  coins ${r.coins}  dd ${r.dd.toFixed(3)}`);
