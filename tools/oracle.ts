// Oracle sweep: buy ONCE per coin at a single trigger event, sell at
// TP / SL / trail / time-stop. Finds WHERE the edge is (if any) before
// building more machinery around it. Loads the dataset once, sweeps in-process.
import { loadDatasetAll } from './dataset.ts';
import { makeHello, phaseSeed, simulate, type Bot } from './sim.ts';

const kit = process.argv[2]!;
const ds = loadDatasetAll(kit);
const hello = makeHello(phaseSeed('pilot-pumpfun-replay', 'dev', ds.sha256));
const LAMPORTS = 1e9;
const CURVE_FEE = 0.0125;

interface P {
  event: 'first' | 'creator2' | 'rq10' | 'rq30' | 'rq50';
  stakeSol: number;
  tp: number; // 0 = never
  sl: number; // 0 = never
  trail: number; // 0 = off
  maxHold: number;
}

function oracle(p: P): Bot {
  const seen = new Set<string>();
  const held = new Map<string, { opened: number; peak: number; cost: number }>();
  const creatorBuy = new Map<string, number>();
  const creator = new Map<string, string>();
  return {
    onBatch(state, batch) {
      const orders: any[] = [];
      const tx = Number(state.txFeeLamports()) / LAMPORTS;
      for (const e of batch.events) {
        if (e.event === 'CreateEvent') creator.set(e.mint, e.creator);
        if (e.event === 'TradeEvent' && e.is_buy && creator.get(e.mint) === e.user) creatorBuy.set(e.mint, (creatorBuy.get(e.mint) ?? 0) + Number(e.sol_amount) / LAMPORTS);
      }
      // Exits.
      for (const [mint, h] of held) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) { if (![...state.pending.values()].some((po) => po.order.mint === mint)) held.delete(mint); continue; }
        if (curve === undefined || curve.complete) continue;
        const mk = batch.marks.find((m) => m.mint === mint);
        const vq = mk ? Number(mk.virtual_quote_reserves) : Number(curve.virtual_quote_reserves);
        const vt = mk ? Number(mk.virtual_token_reserves) : Number(curve.virtual_token_reserves);
        const tokens = Number(pos.token_amount);
        const value = ((tokens * vq) / (vt + tokens) / LAMPORTS) * (1 - CURVE_FEE) - tx;
        if (value > h.peak) h.peak = value;
        const gain = value / h.cost - 1;
        const peakGain = h.peak / h.cost - 1;
        let exit = false;
        if (p.tp > 0 && gain >= p.tp) exit = true;
        if (p.sl > 0 && gain <= -p.sl) exit = true;
        if (p.trail > 0 && peakGain >= 0.05 && value < h.peak * (1 - p.trail)) exit = true;
        if (batch.slot - h.opened > p.maxHold) exit = true;
        if (!exit) continue;
        if ([...state.pending.values()].some((po) => po.order.mint === mint && po.order.side === 'sell')) continue;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10000 });
      }
      // Entries.
      for (const e of batch.events) {
        if (e.event !== 'TradeEvent') continue;
        const mint = e.mint;
        if (seen.has(mint) || held.has(mint)) continue;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        const rq = Number(curve.real_quote_reserves) / LAMPORTS;
        let fire = false;
        if (p.event === 'first') fire = true;
        else if (p.event === 'creator2') fire = (creatorBuy.get(mint) ?? 0) >= 2 && rq >= 2;
        else if (p.event === 'rq10') fire = rq >= 10;
        else if (p.event === 'rq30') fire = rq >= 30;
        else if (p.event === 'rq50') fire = rq >= 50;
        if (!fire) continue;
        const capSol = Math.floor(Number(state.maxBuyLamports(mint))) / LAMPORTS;
        const amount = Math.min(capSol, p.stakeSol);
        if (amount < 0.01) continue;
        seen.add(mint);
        held.set(mint, { opened: batch.slot, peak: 0, cost: amount });
        orders.push({ side: 'buy', mint, quote_lamports: BigInt(Math.floor(amount * LAMPORTS)), max_slippage_bps: 10000 });
      }
      return orders;
    },
  };
}

const sol = (x: bigint) => (Number(x) / 1e9).toFixed(3);
const events: P['event'][] = ['first', 'creator2', 'rq10', 'rq30', 'rq50'];
const exits = [
  { tp: 0, sl: 0, trail: 0, maxHold: 3000 },
  { tp: 0, sl: 0, trail: 0, maxHold: 10000 },
  { tp: 0, sl: 0.5, trail: 0, maxHold: 3000 },
  { tp: 0, sl: 0.15, trail: 0.2, maxHold: 1500 },
  { tp: 0.5, sl: 0.1, trail: 0.15, maxHold: 1500 },
];
for (const ev of events) {
  for (const ex of exits) {
    const p: P = { event: ev, stakeSol: 0.1, ...ex };
    const r = simulate(ds, hello, oracle(p));
    console.log(`${ev} tp=${ex.tp} sl=${ex.sl} trail=${ex.trail} hold=${ex.maxHold}: net ${sol(r.netPnl)} trips ${r.trips.length} wins ${r.trips.filter((t) => t.pnl > 0n).length} dd ${r.maxDrawdown.toFixed(3)}`);
  }
}
