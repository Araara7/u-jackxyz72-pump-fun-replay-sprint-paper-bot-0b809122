// Offline backtest of strategy.ts on the kit's dev window (ALL 3 parts),
// using the local engine port (tools/sim.ts, vendored from the kit).
//
//   node tools/backtest.ts <kit dir> ['{"stakeSol":0.2}'] [--trips] [--part 0]
//
// Prints net PnL, fills, coins, drawdown and reject reasons; --trips lists
// every round trip. --part N restricts to one part (holdout checks).

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createStrategy, DEFAULT_PARAMS, type Params } from '../strategy.ts';
import { loadDatasetAll } from './dataset.ts';
import { makeHello, phaseSeed, simulate, type Dataset } from './sim.ts';

const kit = process.argv[2];
if (kit === undefined) {
  console.error('usage: node tools/backtest.ts <kit dir> [params json] [--trips] [--part N]');
  process.exit(2);
}
const overrides = process.argv[3] !== undefined && process.argv[3].startsWith('{') ? (JSON.parse(process.argv[3]) as Partial<Params>) : {};
const partIdx = process.argv.indexOf('--part');
const part = partIdx >= 0 ? Number(process.argv[partIdx + 1]) : null;
const ds = part === null ? loadDatasetAll(kit) : loadDatasetAll(kit, part);
const hello = makeHello(phaseSeed('pilot-pumpfun-replay', 'dev', ds.sha256));
const { early: _e, comp: _c, ...rest } = overrides as any;
const params: Params = {
  ...DEFAULT_PARAMS,
  ...(overrides.early !== undefined ? { early: { ...DEFAULT_PARAMS.early, ...overrides.early } } : {}),
  ...(overrides.comp !== undefined ? { comp: { ...DEFAULT_PARAMS.comp, ...overrides.comp } } : {}),
  ...rest,
};
const r = simulate(ds, hello, createStrategy(params));
const sol = (x: bigint) => (Number(x) / 1e9).toFixed(6);
console.log(`net ${sol(r.netPnl)} SOL  fills ${r.fills}  coins ${r.mints}  trips ${r.trips.length}  wins ${r.trips.filter((t) => t.pnl > 0n).length}  dd ${r.maxDrawdown.toFixed(4)}  rejected ${r.rejected} ${JSON.stringify(r.rejectReasons)}  failed ${r.failed}`);
const noFail = simulate(ds, hello, createStrategy(params), { failKey: null });
const twoX = simulate(ds, hello, createStrategy(params), { feeMultiplier: 2n });
console.log(`without failed txs ${sol(noFail.netPnl)}  at 2x fees ${sol(twoX.netPnl)}`);
const top = [...r.perMint.entries()].sort((a, b) => (b[1] > a[1] ? 1 : -1)).slice(0, 3);
const topSum = top.reduce((s, [, v]) => s + v, 0n);
console.log(`top3 coins ${sol(topSum)} SOL (${top.map(([m, v]) => `${m.slice(0, 6)}:${sol(v)}`).join(' ')})  net ex-top3 ${sol(r.netPnl - topSum)}`);
if (process.argv.includes('--trips')) {
  for (const t of r.trips) console.log(t.mint, t.open, t.close - t.open, sol(t.pnl));
}
