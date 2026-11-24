// Focused sweep: EARLY mode only (comp disabled — the sweep showed the
// comp mode drags every cell down). Finer grid on the early exits/sizing.
import { loadDatasetAll } from './dataset.ts';
import { makeHello, phaseSeed, simulate } from './sim.ts';
import { createStrategy, DEFAULT_PARAMS, type Params } from '../strategy.ts';

const kit = process.argv[2]!;
const dsAll = loadDatasetAll(kit);
const ds0 = loadDatasetAll(kit, 0);
const ds12 = { ...loadDatasetAll(kit, 1), batches: [...loadDatasetAll(kit, 1).batches, ...loadDatasetAll(kit, 2).batches] };
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
const cells: { label: string; o: any }[] = [];
cells.push({ label: 'early-only base', o: OFF });
for (const s of [0.01, 0.02, 0.05]) cells.push({ label: `stake=${s}`, o: { ...OFF, early: { stakeSol: s } } });
for (const c of [1, 5]) cells.push({ label: `creator>=${c}`, o: { ...OFF, early: { minCreatorBuy: c } } });
for (const a of [50, 200, 400]) cells.push({ label: `maxAge=${a}`, o: { ...OFF, early: { maxAge: a } } });
for (const t of [0.15, 0.4, 0.6]) cells.push({ label: `trail=${t}`, o: { ...OFF, early: { trail: t } } });
for (const h of [0.15, 0.4, 0.6]) cells.push({ label: `hardStop=${h}`, o: { ...OFF, early: { hardStop: h } } });
for (const h of [400, 1500, 3000]) cells.push({ label: `maxHold=${h}`, o: { ...OFF, early: { maxHold: h } } });
for (const n of [0.3, 1.0]) cells.push({ label: `minNetSol=${n}`, o: { ...OFF, early: { minNetSol: n } } });
for (const b of [4, 8]) cells.push({ label: `minBuyers=${b}`, o: { ...OFF, early: { minBuyers: b } } });
for (const f of [0.2, 2.0]) cells.push({ label: `fadeNet=${f}`, o: { ...OFF, early: { fadeNetSol: f } } });
cells.push({ label: 'no-fade', o: { ...OFF, early: { fadeNetSol: 1000 } } });
cells.push({ label: 'no-bigSell', o: { ...OFF, early: { bigSellSol: 1000 } } });
cells.push({ label: 'no-earlyExit', o: { ...OFF, early: { earlyExitLoss: 1 } } });
cells.push({ label: 'no-newHigh', o: { ...OFF, early: { noNewHighSlots: 1000000 } } });
cells.push({ label: 'rungs+50/+100', o: { ...OFF, early: { rungs: [[0.5, 0.25], [1.0, 0.25]] } } });
cells.push({ label: 'no-rungs', o: { ...OFF, early: { rungs: [] } } });
cells.push({ label: 'stake02+creator5', o: { ...OFF, early: { stakeSol: 0.02, minCreatorBuy: 5 } } });
cells.push({ label: 'stake02+trail04', o: { ...OFF, early: { stakeSol: 0.02, trail: 0.4 } } });
cells.push({ label: 'stake02+hold1500', o: { ...OFF, early: { stakeSol: 0.02, maxHold: 1500 } } });

const rows: any[] = [];
for (const c of cells) {
  const params = merge(DEFAULT_PARAMS, c.o);
  const r = simulate(dsAll, hello, createStrategy(params));
  const r0 = simulate(ds0, hello, createStrategy(params));
  rows.push({ label: c.label, net: sol(r.netPnl), net0: sol(r0.netPnl), trips: r.trips.length, wins: r.trips.filter((t) => t.pnl > 0n).length, coins: r.mints, dd: r.maxDrawdown });
}
rows.sort((a, b) => b.net - a.net);
for (const r of rows) console.log(`${r.label.padEnd(24)} net ${r.net.toFixed(3)} (part0 ${r.net0.toFixed(3)})  trips ${r.trips}  wins ${r.wins}  coins ${r.coins}  dd ${r.dd.toFixed(3)}`);
