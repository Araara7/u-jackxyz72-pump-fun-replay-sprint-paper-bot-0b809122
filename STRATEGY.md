# Kutu Loncat Replay — strategy notes

Pump.fun replay bot for the make.fun bounty
"Pump.fun Replay Sprint — Paper Bot, Real Ranking"
(`u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122`).
10 SOL paper capital, 24h replay, ranked by net PnL after fees (> 0 to
win a place). Guardrails: round trip ≥ 0.01 SOL on ≥ 20 coins, max
drawdown ≤ 50%.

## Where the design comes from

The bot adapts the user's Solana paper-trading scanner (V9: gate v7r + AI
judge v2; V8 final report 21 Nov 2026) and the BTC "Breakout Rider" bot
to the replay's own data model. The scanner's verdict was that the ENTRY
was broken, not the exit — so this bot keeps the scanner's exit machinery
and rebuilds entry on on-chain tape only.

### Scanner rules ADAPTED

| Scanner (V9 / V8 bedah) | Replay translation |
|---|---|
| bundler in [0.15, 0.5) — low bundler = dump trait | top-buyer share of window buy SOL ≤ 60–80% |
| fee floor (≥ 0.3 SOL young / ≥ 4 SOL refined) | real SOL reserve band + net traded SOL |
| holders ≥ 93 | distinct buyers on the tape (≥ 8 for entry) |
| creator balance / skin in the game | creator's own buys ≥ 5 SOL — strongest filter found (24% reach 2x vs 13% for creator < 0.5 SOL) |
| scale-out ladder +25/+50/+100% | rungs +100%/+200% (early), +50%/+100% (comp add) |
| stepped SL ladder | same shape: floor rises with peak gain |
| trail 20% (confirmed by bedah) | trail 25% early / 20% comp, armed at +10%/+5% |
| early-exit −10% at 6 min (kills 0 winners, cuts 16 losers) | early-exit −10% at 150 slots (~1 min replay pace) |
| LP-drain MENGURAS exit | single sell ≥ 0.5–1 SOL or net flow < −0.5/−1 SOL over 15 slots |
| no-new-high / time-stop 60 min | no-new-high 600 slots, time-stop 750/1500 slots |
| Breakout Rider: new-high entry, no fixed TP, re-arm | nearHigh 0.90–0.95, cooldown 150 slots after exit |
| V8 lesson: expectancy is lottery-driven, top 5 trades > total | small early tickets + bigger adds on survivors; let the last 25% ride the trail |

### Scanner rules DELIBERATELY NOT used (and why)

- **GMGN honeypot / tax / LP-lock / top-10 / creator-balance gates** —
  pump.fun curves have no mint/freeze authority, no tax, no LP to lock;
  the replay universe already excludes mayhem/cashback coins. There is
  nothing to check.
- **AI judge v2** — no LLM in the no-network sandbox. Its role (a strict
  second opinion after the gates) is played by the creator-buy + distinct-
  buyer filters instead.
- **Breakout Rider's 2% trail** — BTC intraday dips are < 1%; pump.fun
  swings 10–30% in minutes. The bedah-confirmed 20–25% trail is used.
- **All-in sizing** — the 5-position cap + 1% reserve cap make all-in
  impossible and wrong; stakes are 0.02 SOL early, topped to 0.20 SOL.
- **Fee floor ≥ 4 SOL as a hard gate** — in the replay, fee-24h ≈ total
  traded SOL; early coins have small volume by definition. Real reserve +
  net flow replace it.
- **Holders > 300 fail** — already removed in the scanner itself (protocol
  v2.2, user instruction 22 Nov); many buyers is good here, watched only
  via the top-buyer share.
- **Standalone completion-run entries** — measured and rejected: buying
  at rq ≥ 30 with window filters loses −0.65 SOL on its own (the filters
  buy near the local high). Only the *add* into a creator-backed early
  position survived measurement.

## What was measured (full dev window, all 3 parts, kit's own sim)

- Kit pilots: momentum −9.38 SOL (part 0), sniper −0.49 SOL, reversion
  −4.02 SOL. All lose.
- Oracle grid (buy once per coin at first trade / creator ≥ 2 / rq 10 /
  rq 30 / rq 50 × 5 exit sets): every cell loses; best is rq 50 + tight
  exits at −0.16 SOL.
- ~100 sweep cells over this bot's parameters. Best family: early-only,
  creator ≥ 5 SOL, 0.02 SOL stakes, ≥ 8 buyers, plus completion-run adds
  only.

## Final local validation (shipped defaults)

```
net +0.060074 SOL after fees   fills 335   coins 88   trips 166
wins 21   max drawdown 0.0131   rejected 0   failed txs 8
without failed txs +0.055   at 2x fees -0.036
per-part: part0 -0.107 / part1 +0.148 / part2 -0.060
```

Guardrails: 88 coins ≥ 20 ✓, 166 round trips at 0.02 SOL ≥ 0.01 ✓,
drawdown 0.013 ≤ 0.50 ✓.

**Honest caveat:** the positive full-window number is lottery-driven —
one coin (26wNSX, part 1) contributes +0.195 SOL; without it the window
is −0.144 SOL. That is the same pattern as V8 (top trades > total). The
final window is fresh data, so this is a lottery-catching design with
tiny drawdown, not a proven positive expectancy. Parameters were picked
from a flat region (comp stake 0.15/0.20/0.25 all positive), never the
single best cell.

## Files

- `main.ts` — entrypoint (`node /bot/main.ts`).
- `strategy.ts` — the bot (own code; entry gates + V9 exits).
- `vendor/makefun-bot.ts` — kit SDK shim, vendored byte for byte.
- `tools/sim.ts` — local engine port, vendored from the kit (import path
  adjusted to the shim name).
- `tools/dataset.ts`, `tools/backtest.ts`, `tools/sweep*.ts`,
  `tools/oracle.ts` — validation harness (not part of the graded bot).
