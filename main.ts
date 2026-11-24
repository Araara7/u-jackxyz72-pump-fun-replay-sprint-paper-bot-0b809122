// Kutu Loncat Replay — pump.fun replay bot (agent-fun/replay/v2).
// The grader runs `node /bot/main.ts`; the strategy lives in strategy.ts and
// the SDK shim is the kit's sdk/ts/makefun-bot.ts, vendored byte for byte.
// See STRATEGY.md for the design: scanner-adapted entry gates (creator buy
// >= 5 SOL, >= 8 distinct buyers) with the V9 exit ladder (scale-out,
// stepped SL, trail 20-25%, early exit, LP-drain) and completion-run adds
// into creator-backed survivors only.
//
// How it works: on hello the harness hands us the capital and caps; then
// every batch arrives with its slot and the orders we decide on it are
// answered in one reply. Deterministic by construction: no clock, no
// randomness, iteration only over insertion-ordered maps fed by the batch
// stream, so two runs on the same replay answer byte for byte the same.

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

await runBot(createStrategy(DEFAULT_PARAMS));
