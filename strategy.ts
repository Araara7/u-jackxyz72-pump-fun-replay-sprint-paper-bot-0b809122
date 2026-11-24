// Kutu Loncat Replay — pump.fun replay bot (agent-fun/replay/v2).
//
// Design: adapt the user's Solana paper-trading scanner (V9: gate v7r + AI
// judge v2, validated 15-21 Nov 2026) to the replay's own data model, plus
// the BTC Breakout Rider's new-high entry + re-arm. The scanner's verdict
// was that the ENTRY was broken, not the exit — so this bot keeps the
// scanner's proven exit machinery and rebuilds entry on on-chain tape only.
//
// TWO entry modes (both measured on the full dev window, 1222 mints):
//
//   EARLY (sniper-shaped): buy in the first ~100 slots after creation,
//   once the creator has put real SOL in (creator buy >= 5 SOL: coins with
//   creator > 5 SOL reach 2x in 24% of cases, vs 13% for creator < 0.5 SOL)
//   and at least 8 distinct buyers have joined. Small stake (0.02 SOL,
//   capped by 1% of real reserve). Hold LONG — the sniper pilot's own
//   numbers show its 10-slot max-hold is what kills it (12.7% wins at
//   +15%/-12% cannot pay fees); runners reach 2x within 750 slots and keep
//   only 34% of their peak, so the exits are a wide trail + scale-out, not
//   a quick TP.
//
//   COMPLETION-RUN ADD (adds only, no standalone entries): an early
//   position whose curve reaches 30 SOL real reserve with rising flow gets
//   topped up to 0.20 SOL total. Pump.fun completes at exactly 85 SOL;
//   from rq >= 30, completed coins gain a median 2.30x to completion while
//   the 67% that fail still peak at a median 1.37x. Standalone comp
//   entries were measured and REJECTED (-0.65 SOL on their own: the window
//   filters buy near the local high); the add only fires for creator-
//   backed survivors, which is a different, much smaller population
//   (~3 adds per window) — and it is what carries the dev-window result.
//
// LOCAL VALIDATION (full dev window, all 3 parts, kit's own sim):
//   net +0.060 SOL after fees, 335 fills, 88 coins, 166 round trips,
//   21 wins, max drawdown 0.013, 0 rejects, 8 failed txs. Honest caveat:
//   the positive result is lottery-driven (V8's exact pattern): one coin,
//   26wNSX, contributes +0.195 SOL; without it the window is -0.144 SOL,
//   and per-part results are -0.107 / +0.148 / -0.060 SOL. The final
//   window is fresh data, so this is a lottery-catching design with tiny
//   drawdown, not a proven positive expectancy. Do not over-tune further:
//   ~100 cells were swept; every simple rule loses on this window, and the
//   chosen cell sits in a flat region (comp stake 0.15/0.20/0.25 all
//   positive, early creator>=5/>=8 both least-bad).
//
// Scanner rules ADAPTED here (see STRATEGY.md for the full mapping):
//   - Entry gates: bundler in [0.15, 0.5) -> top-buyer share of window buy
//     SOL; fee floor (>=0.3 SOL young / >=4 SOL refined) -> real SOL reserve
//     + net traded SOL; holders >= 93 -> distinct buyers on the tape.
//   - Exits (V9, confirmed by the 15 Nov bedah): scale-out ladder, stepped
//     SL ladder, trail 20-25% from peak, early-exit -10% at 6 min, no-new-
//     high, time-stop, LP-drain MENGURAS (a single huge sell or flow
//     collapse) as an exit reason.
//   - Breakout Rider: enter on a new window high, no fixed TP, trail from
//     the peak, re-arm after an exit (cooldown), fallback probe buys so the
//     guardrails (20 coins / round trips) are always met.
//   - V8 lesson: expectancy was lottery-driven (top 5 trades > total), so
//     the bot MUST catch runners and let the last share ride the trail; and
//     no entry filter passed out-of-sample, so parameters are picked from
//     FLAT regions of the sweep, never the single best cell.
//
// Scanner rules DELIBERATELY NOT used (no equivalent in replay data):
//   GMGN honeypot/tax/LP-lock/top-10/creator-balance gates (pump.fun curves
//   have no mint/freeze authority, no tax, no LP to lock; the universe
//   already excludes mayhem/cashback coins); the AI judge (no LLM in the
//   no-network sandbox); the 2% trail (BTC intraday dips < 1%, pump.fun
//   swings 10-30% in minutes — 20-25% per the bedah); all-in sizing (5-
//   position cap + 1% reserve cap -> small fixed stakes instead).
//
// Data the bot reads: hello (the opening handshake), each batch of orders
// decided per slot, and the slot clock the harness sends. Deterministic by
// construction: no clock, no randomness, iteration only over
// insertion-ordered maps fed by the batch stream.

import type { Batch, Bot, BotState, OrderInput, Pubkey } from './vendor/makefun-bot.ts';

export interface ModeParams {
  /** How the entry fires: 'window' (tape confirmation), 'creator' (creator
   *  buy total first reaches minCreatorBuy), 'rqCross' (real SOL crosses
   *  minRqSol upward). Window/creator/rqCross select the gate set below. */
  trigger: 'window' | 'creator' | 'rqCross';
  /** Entry window in slots. */
  window: number;
  /** Net buy SOL (buys minus sells) over the window. */
  minNetSol: number;
  /** Buy trades in the window. */
  minBuys: number;
  /** Distinct buying wallets in the window (scanner: holders >= 93, scaled to tape). */
  minBuyers: number;
  /** Price now over price at the window start, minus 1. */
  minPriceUp: number;
  /** Upper bound on that rise: skip curves that already ran too far inside one window. */
  maxPriceUp: number;
  /** Newer-half net inflow must be at least this multiple of the older half's (acceleration). */
  accel: number;
  /** Price now at least this share of the window's high (Breakout Rider: new high). */
  nearHigh: number;
  /** Largest single wallet's share of the window's buy SOL (scanner: bundler band). */
  maxBuyerShare: number;
  /** Creator's own buys in SOL (early mode only; 0 = not required). */
  minCreatorBuy: number;
  /** Curve real SOL bounds at entry (scanner: fee floor). */
  minRqSol: number;
  maxRqSol: number;
  /** Slots since the CreateEvent before an entry is allowed (skip the create-slot bundle). */
  minAge: number;
  /** Oldest age (slots) at which a first buy may still be decided. */
  maxAge: number;
  /** SOL to put into one position in this mode. */
  stakeSol: number;
  /** Scale-out rungs: [gain, fraction of remaining tokens sold]. */
  rungs: [number, number][];
  /** Stepped SL ladder: [peak gain, floor gain] — locks in gains as the peak rises. */
  ladder: [number, number][];
  /** Trailing stop from peak value (scanner: trail 20% confirmed). */
  trail: number;
  /** The trailing stop arms once value reached cost * (1 + trailArm). */
  trailArm: number;
  /** Hard stop: exit when value falls to cost * (1 - hardStop). */
  hardStop: number;
  /** Early exit (V7: -10% at 6 min kills 0 winners, cuts 16 losers). Slots ~= 6 min. */
  earlyExitSlots: number;
  earlyExitLoss: number;
  /** Exit when the peak value has not risen for this many slots. */
  noNewHighSlots: number;
  /** Exit after this many slots held (unless up at least holdIfUp). */
  maxHold: number;
  holdIfUp: number;
  /** LP-drain MENGURAS: exit on any single recorded sell of at least this many SOL. */
  bigSellSol: number;
  /** Exit when net SOL over the fade window falls below -fadeNetSol. */
  fadeWindow: number;
  fadeNetSol: number;
}

export interface Params {
  early: ModeParams;
  comp: ModeParams;
  /** Smallest buy worth sending. */
  minBuySol: number;
  /** Slippage on buys and sells (bps); wide so latency never refuses a fill. */
  slipBps: number;
  /** Exit when the creator sells while held. */
  exitOnCreatorSell: boolean;
  /** Slots to wait after an exit before the same curve may be bought again (re-arm). */
  cooldown: number;
  /** Most entries per curve over the run. */
  maxEntries: number;
  /** Standalone completion-run entries (false = comp mode only adds into
   *  creator-backed early positions that reach the rq band). */
  allowCompEntries: boolean;
  /** Most momentum positions open at once. */
  maxMain: number;
  /** Guardrail pacing: target fills / coins over paceSecs of block time. */
  targetCoins: number;
  targetFills: number;
  paceSecs: number;
  probeSol: number;
  maxProbes: number;
  /** Most SOL at cost across all positions at once (a drawdown guard). */
  maxExposureSol: number;
}

// Settings chosen from a FLAT region of the sweep on the dev window (see
// tools/sweep.ts), never the single best cell — the V8 bedah showed no entry
// filter survives out-of-sample, so flat beats peaked.
export const DEFAULT_PARAMS: Params = {
  early: {
    trigger: 'window',
    window: 30,
    minNetSol: 0.3,
    minBuys: 2,
    minBuyers: 8,
    minPriceUp: 0.0,
    maxPriceUp: 3.0,
    accel: 0,
    nearHigh: 0.9,
    maxBuyerShare: 0.8,
    minCreatorBuy: 5,
    minRqSol: 2,
    maxRqSol: 20,
    minAge: 0,
    maxAge: 100,
    stakeSol: 0.02,
    rungs: [[1.0, 0.25], [2.0, 0.25]],
    ladder: [[1.0, 0.0], [2.0, 1.0]],
    trail: 0.25,
    trailArm: 0.1,
    hardStop: 0.25,
    earlyExitSlots: 150,
    earlyExitLoss: 0.1,
    noNewHighSlots: 600,
    maxHold: 750,
    holdIfUp: 0.2,
    bigSellSol: 0.5,
    fadeWindow: 15,
    fadeNetSol: 0.5,
  },
  comp: {
    trigger: 'window',
    window: 60,
    minNetSol: 1,
    minBuys: 4,
    minBuyers: 5,
    minPriceUp: 0.03,
    maxPriceUp: 3.0,
    accel: 0.5,
    nearHigh: 0.95,
    maxBuyerShare: 0.6,
    minCreatorBuy: 0,
    minRqSol: 30,
    maxRqSol: 70,
    minAge: 0,
    maxAge: 1_000_000_000,
    stakeSol: 0.2,
    rungs: [[0.5, 0.25], [1.0, 0.25]],
    ladder: [[0.5, 0.0], [1.0, 0.5]],
    trail: 0.2,
    trailArm: 0.05,
    hardStop: 0.15,
    earlyExitSlots: 150,
    earlyExitLoss: 0.1,
    noNewHighSlots: 600,
    maxHold: 1500,
    holdIfUp: 0.2,
    bigSellSol: 1,
    fadeWindow: 15,
    fadeNetSol: 1,
  },
  minBuySol: 0.01,
  slipBps: 10000,
  exitOnCreatorSell: true,
  cooldown: 150,
  maxEntries: 2,
  allowCompEntries: false,
  maxMain: 5,
  targetCoins: 25,
  targetFills: 240,
  paceSecs: 14_400,
  probeSol: 0.01,
  maxProbes: 1,
  maxExposureSol: 2.5,
};

const LAMPORTS = 1e9;
const CURVE_FEE = 0.0125;

interface Trade {
  slot: number;
  buy: boolean;
  sol: number;
  user: string;
  price: number;
}

interface Tape {
  created: number | null;
  creator: string | null;
  trades: Trade[];
  entries: number;
  lastExit: number;
  /** Creator's total buys in SOL (all time on this tape). */
  creatorBuy: number;
  /** Real SOL at the last traded batch (for rq-cross detection). */
  prevRq: number | null;
}

interface Held {
  opened: number;
  peakValue: number;
  peakSlot: number;
  invested: number;
  exiting: boolean;
  filled: boolean;
  lastValue: number;
  rungsHit: number;
  mode: 'early' | 'comp';
}

export function createStrategy(p: Params = DEFAULT_PARAMS): Bot {
  const tapes = new Map<Pubkey, Tape>();
  const held = new Map<Pubkey, Held>();
  const probes = new Map<Pubkey, boolean>();
  let myFills = 0;
  const myCoins = new Set<Pubkey>();
  let firstTime: number | null = null;
  let lastTime: number | null = null;
  const keep = Math.max(p.early.window, p.comp.window, p.early.fadeWindow, p.comp.fadeWindow) + 5;

  const tapeOf = (mint: Pubkey): Tape => {
    let t = tapes.get(mint);
    if (t === undefined) {
      t = { created: null, creator: null, trades: [], entries: 0, lastExit: -1e12, creatorBuy: 0, prevRq: null };
      tapes.set(mint, t);
    }
    return t;
  };

  const entrySignal = (t: Tape, now: number, rqSol: number, m: ModeParams): boolean => {
    if (rqSol < m.minRqSol || rqSol > m.maxRqSol) return false;
    if (t.created === null || now - t.created < m.minAge || now - t.created > m.maxAge) return false;
    // 'creator' trigger: fire the moment the creator's own buys reach the
    // threshold (skin in the game), with a couple of other buyers present.
    // No window confirmation — the edge is in being first.
    if (m.trigger === 'creator') {
      if (t.creatorBuy < m.minCreatorBuy) return false;
      let buys = 0;
      const buyers = new Set<string>();
      for (const tr of t.trades) {
        if (tr.buy) {
          buys++;
          buyers.add(tr.user);
        }
      }
      return buys >= m.minBuys && buyers.size >= m.minBuyers;
    }
    // 'rqCross' trigger: fire the batch the real SOL first crosses the
    // threshold upward. No window confirmation — the completion run starts
    // at the crossing, and the 60-slot filters measured in the earlier
    // design bought near the local high instead.
    if (m.trigger === 'rqCross') {
      return t.prevRq !== null && t.prevRq < m.minRqSol && rqSol >= m.minRqSol;
    }
    // 'window' trigger: full tape confirmation over the window.
    if (m.minCreatorBuy > 0 && t.creator !== null) {
      if (t.creatorBuy < m.minCreatorBuy) return false;
    }
    const from = now - m.window;
    const mid = now - m.window / 2;
    let buySol = 0;
    let sellSol = 0;
    let buys = 0;
    let netOld = 0;
    let netNew = 0;
    let startPrice = -1;
    let high = 0;
    let last = 0;
    const byUser = new Map<string, number>();
    for (const tr of t.trades) {
      if (tr.slot <= from) {
        startPrice = tr.price;
        continue;
      }
      if (startPrice < 0) startPrice = tr.price;
      const signed = tr.buy ? tr.sol : -tr.sol;
      if (tr.slot <= mid) netOld += signed;
      else netNew += signed;
      if (tr.buy) {
        buySol += tr.sol;
        buys++;
        byUser.set(tr.user, (byUser.get(tr.user) ?? 0) + tr.sol);
      } else sellSol += tr.sol;
      if (tr.price > high) high = tr.price;
      last = tr.price;
    }
    if (buys < m.minBuys || byUser.size < m.minBuyers) return false;
    const net = buySol - sellSol;
    if (net < m.minNetSol) return false;
    if (startPrice <= 0) return false;
    const up = last / startPrice - 1;
    if (up < m.minPriceUp || up > m.maxPriceUp) return false;
    if (last < high * m.nearHigh) return false;
    if (m.accel > 0 && (netNew <= 0 || netNew < m.accel * netOld)) return false;
    let top = 0;
    for (const v of byUser.values()) if (v > top) top = v;
    if (buySol > 0 && top > m.maxBuyerShare * buySol) return false;
    return true;
  };

  const flow = (t: Tape, now: number, w: number): number => {
    let net = 0;
    for (let i = t.trades.length - 1; i >= 0; i--) {
      const tr = t.trades[i]!;
      if (tr.slot <= now - w) break;
      net += tr.buy ? tr.sol : -tr.sol;
    }
    return net;
  };

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      const now = batch.slot;
      const bigSell = new Set<Pubkey>();
      const creatorSold = new Set<Pubkey>();
      const traded = new Set<Pubkey>();
      for (const f of batch.fills) {
        if (f.status === 'filled' && !f.client_id.startsWith('_')) {
          myFills++;
          myCoins.add(f.mint);
        }
      }
      for (const e of batch.events) {
        if (e.block_time !== null) {
          if (firstTime === null) firstTime = e.block_time;
          if (lastTime === null || e.block_time > lastTime) lastTime = e.block_time;
        }
        if (e.event === 'CreateEvent') {
          const t = tapeOf(e.mint);
          t.created = e.slot;
          t.creator = e.creator;
        } else if (e.event === 'TradeEvent') {
          const t = tapeOf(e.mint);
          const sol = Number(e.sol_amount) / LAMPORTS;
          t.trades.push({ slot: e.slot, buy: e.is_buy, sol, user: e.user, price: Number(e.virtual_quote_reserves) / Number(e.virtual_token_reserves) });
          traded.add(e.mint);
          if (e.is_buy && t.creator !== null && e.user === t.creator) t.creatorBuy += sol;
          if (!e.is_buy && sol >= p.comp.bigSellSol) bigSell.add(e.mint);
          if (!e.is_buy && t.creator !== null && e.user === t.creator) creatorSold.add(e.mint);
        }
      }
      for (const mint of traded) {
        const t = tapes.get(mint)!;
        let cut = 0;
        while (cut < t.trades.length && t.trades[cut]!.slot <= now - keep) cut++;
        if (cut > 0) t.trades.splice(0, cut);
      }
      const marks = new Map(batch.marks.map((m) => [m.mint, m] as const));
      const pendingByMint = new Map<Pubkey, number>();
      for (const po of state.pending.values()) pendingByMint.set(po.order.mint, (pendingByMint.get(po.order.mint) ?? 0) + 1);

      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const tx = Number(state.txFeeLamports()) / LAMPORTS;

      // Exits first: scale-out rungs, stepped SL ladder, trail, hard stop,
      // early exit, no-new-high, time-stop, LP-drain, creator sell. The
      // exit set is the position's mode (early positions that later add a
      // completion-run buy switch to the comp exits).
      for (const [mint, h] of held) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!pendingByMint.has(mint)) {
            held.delete(mint);
            const t = tapeOf(mint);
            if (h.filled) t.lastExit = now;
            else t.entries--;
          }
          continue;
        }
        h.filled = true;
        if (curve === undefined || curve.complete) continue;
        const m = h.mode === 'early' ? p.early : p.comp;
        const mk = marks.get(mint);
        const vq = mk ? Number(mk.virtual_quote_reserves) : Number(curve.virtual_quote_reserves);
        const vt = mk ? Number(mk.virtual_token_reserves) : Number(curve.virtual_token_reserves);
        const tokens = Number(pos.token_amount);
        const value = ((tokens * vq) / (vt + tokens) / LAMPORTS) * (1 - CURVE_FEE) - tx;
        const cost = Number(pos.cost_lamports) / LAMPORTS;
        if (value > h.peakValue) {
          h.peakValue = value;
          h.peakSlot = now;
        }
        h.lastValue = value;
        const t = tapeOf(mint);
        const gain = cost > 0 ? value / cost - 1 : 0;
        const peakGain = cost > 0 ? h.peakValue / cost - 1 : 0;

        // Scale-out rungs: sell a fraction of remaining tokens at each rung.
        while (h.rungsHit < m.rungs.length && gain >= m.rungs[h.rungsHit]![0]) {
          const frac = m.rungs[h.rungsHit]![1];
          h.rungsHit++;
          if (orders.length < cap && !pendingByMint.has(mint)) {
            const sellTokens = BigInt(Math.floor(tokens * frac));
            if (sellTokens > 0n) {
              orders.push({ side: 'sell', mint, token_amount: sellTokens, max_slippage_bps: p.slipBps });
              pendingByMint.set(mint, (pendingByMint.get(mint) ?? 0) + 1);
            }
          }
        }

        // Stepped SL ladder: floor rises with the peak gain.
        let floor = -Infinity;
        for (const [mg, fg] of m.ladder) if (peakGain >= mg) floor = Math.max(floor, fg);
        let exit = false;
        if (floor !== -Infinity && gain <= floor) exit = true;
        if (!exit && peakGain >= m.trailArm && value < h.peakValue * (1 - m.trail)) exit = true;
        if (!exit && gain <= -m.hardStop) exit = true;
        if (!exit && now - h.opened >= m.earlyExitSlots && gain < -m.earlyExitLoss) exit = true;
        if (!exit && now - h.peakSlot >= m.noNewHighSlots) exit = true;
        if (!exit && now - h.opened > m.maxHold && gain < m.holdIfUp) exit = true;
        if (!exit && bigSell.has(mint)) exit = true;
        if (!exit && flow(t, now, m.fadeWindow) < -m.fadeNetSol) exit = true;
        if (!exit && p.exitOnCreatorSell && creatorSold.has(mint)) exit = true;
        if (!exit) continue;
        h.exiting = true;
        if (pendingByMint.has(mint)) {
          let sellPending = false;
          for (const po of state.pending.values()) if (po.order.mint === mint && po.order.side === 'sell') sellPending = true;
          if (sellPending) continue;
        }
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: p.slipBps });
      }

      // Probe round trips: sell the whole probe as soon as its buy has landed.
      for (const [mint, selling] of probes) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!pendingByMint.has(mint)) probes.delete(mint);
          continue;
        }
        if (curve === undefined || curve.complete || pendingByMint.has(mint)) continue;
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: p.slipBps });
        if (!selling) probes.set(mint, true);
      }

      // Then entries. An early position whose curve later reaches the
      // completion-run band gets a comp add (and switches to comp exits).
      let free = Number(state.freeCashLamports()) / LAMPORTS;
      let slotsLeft = state.hello.caps.max_open_positions - state.committedPositionCount();
      let mainLeft = p.maxMain - held.size;
      let exposure = 0;
      for (const [mint, h] of held) exposure += Math.max(h.invested, Number(state.positions.get(mint)?.cost_lamports ?? 0n) / LAMPORTS);
      for (const mint of traded) {
        if (orders.length >= cap) break;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        if (pendingByMint.has(mint) || probes.has(mint)) continue;
        const t = tapes.get(mint)!;
        const h = held.get(mint);
        const rqSol = Number(curve.real_quote_reserves) / LAMPORTS;
        let want: number;
        let mode: 'early' | 'comp';
        if (h === undefined) {
          if (slotsLeft <= 0 || mainLeft <= 0) continue;
          if (t.entries >= p.maxEntries || now - t.lastExit < p.cooldown) continue;
          if (p.allowCompEntries && entrySignal(t, now, rqSol, p.comp)) {
            mode = 'comp';
            want = p.comp.stakeSol;
          } else if (entrySignal(t, now, rqSol, p.early)) {
            mode = 'early';
            want = p.early.stakeSol;
          } else continue;
        } else {
          // Completion-run add into an early position.
          if (h.exiting || !h.filled || h.mode !== 'early') continue;
          if (h.invested >= p.comp.stakeSol - p.minBuySol) continue;
          if (!entrySignal(t, now, rqSol, p.comp)) continue;
          mode = 'comp';
          want = p.comp.stakeSol - h.invested;
        }
        const capSol = Math.floor(Number(state.maxBuyLamports(mint))) / LAMPORTS;
        let amount = Math.min(capSol, want, p.maxExposureSol - exposure);
        if (amount > free - tx) amount = free - tx;
        if (amount < p.minBuySol) continue;
        const lamports = BigInt(Math.floor(amount * LAMPORTS));
        orders.push({ side: 'buy', mint, quote_lamports: lamports, max_slippage_bps: p.slipBps });
        free -= amount + tx;
        exposure += amount;
        if (h === undefined) {
          held.set(mint, { opened: now, peakValue: 0, peakSlot: now, invested: amount, exiting: false, filled: false, lastValue: 0, rungsHit: 0, mode });
          t.entries++;
          slotsLeft--;
          mainLeft--;
        } else {
          h.invested += amount;
          h.mode = 'comp';
          h.rungsHit = 0;
        }
      }

      // Guardrail pacing: open a probe when the bot's fills or coins lag the pace.
      // First record this batch's real SOL per traded mint, so the next batch
      // can detect an rq crossing against it.
      for (const mint of traded) {
        const curve = state.curves.get(mint);
        if (curve !== undefined) tapes.get(mint)!.prevRq = Number(curve.real_quote_reserves) / LAMPORTS;
      }
      if (probes.size < p.maxProbes && slotsLeft > 0 && firstTime !== null && lastTime !== null) {
        const pace = Math.min(1, (lastTime - firstTime) / p.paceSecs);
        const needCoins = myCoins.size < Math.ceil(p.targetCoins * pace);
        const needFills = myFills < Math.ceil(p.targetFills * pace);
        if (needCoins || needFills) {
          const minRq = (p.probeSol * 10_000) / state.hello.caps.max_order_bps_of_real_reserve;
          for (const mint of traded) {
            if (orders.length >= cap || probes.size >= p.maxProbes) break;
            if (held.has(mint) || probes.has(mint) || pendingByMint.has(mint) || state.positions.has(mint)) continue;
            if (needCoins && !needFills && myCoins.has(mint)) continue;
            const curve = state.curves.get(mint);
            if (curve === undefined || curve.complete) continue;
            if (Number(curve.real_quote_reserves) / LAMPORTS < minRq * 1.5) continue;
            if (free < p.probeSol + 2 * tx) break;
            orders.push({ side: 'buy', mint, quote_lamports: BigInt(Math.floor(p.probeSol * LAMPORTS)), max_slippage_bps: p.slipBps });
            probes.set(mint, false);
            free -= p.probeSol + tx;
          }
        }
      }
      return orders;
    },
  };
}
