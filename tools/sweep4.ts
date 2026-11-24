// Fourth sweep: adds-only comp family (the only positive full-window cell).
// Vary the add size / rq band / trail to find whether the positive region
// is flat (robust) or a single lottery coin (fragile).
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
const BASE = { allowCompEntries: false, early: { minCreatorBuy: 5, stakeSol: 0.02, minBuyers: 8 } };
const cells: { label: string; o: any }[] = [];
cells.push({ label: 'adds-only base', o: BASE });
for (const s of [0.1, 0.2, 0.25]) cells.push({ label: `comp.stake=${s}`, o: { ...BASE, comp: { stakeSol: s } } });
for (const r of [25, 40]) cells.push({ label: `comp.minRq=${r}`, o: { ...BASE, comp: { minRqSol: r } } });
for (const t of [0.15, 0.3]) cells.push({ label: `comp.trail=${t}`, o: { ...BASE, comp: { trail: t } } });
for (const h of [0.1, 0.25]) cells.push({ label: `comp.hardStop=${h}`, o: { ...BASE, comp: { hardStop: h } } });
cells.push({ label: 'comp.rungs+25/+50', o: { ...BASE, comp: { rungs: [[0.25, 0.25], [0.5, 0.25]] } } });
cells.push({ label: 'comp.no-rungs', o: { ...BASE, comp: { rungs: [] } } });
cells.push({ label: 'comp.hold750', o: { ...BASE, comp: { maxHold: 750 } } });
for (const s of [0.01, 0.03]) cells.push({ label: `early.stake=${s}`, o: { ...BASE, early: { ...BASE.early, stakeSol: s } } });
cells.push({ label: 'early.cre8', o: { ...BASE, early: { ...BASE.early, minCreatorBuy: 8 } } });
cells.push({ label: 'early.buyers5', o: { ...BASE, early: { ...BASE.early, minBuyers: 5 } } });

const rows: any[] = [];
for (const c of cells) {
  const params = merge(DEFAULT_PARAMS, c.o);
  const r = simulate(dsAll, hello, createStrategy(params));
  const r0 = simulate(ds0, hello, createStrategy(params));
  rows.push({ label: c.label, net: sol(r.netPnl), net0: sol(r0.netPnl), trips: r.trips.length, wins: r.trips.filter((t) => t.pnl > 0n).length, coins: r.mints, dd: r.maxDrawdown });
}
rows.sort((a, b) => b.net - a.net);
for (const r of rows) console.log(`${r.label.padEnd(24)} net ${r.net.toFixed(3)} (part0 ${r.net0.toFixed(3)})  trips ${r.trips}  wins ${r.wins}  coins ${r.coins}  dd ${r.dd.toFixed(3)}`);
