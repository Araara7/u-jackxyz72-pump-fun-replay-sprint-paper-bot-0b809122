# Kutu Loncat Replay

[![make.fun](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/Araara7/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/Araara7/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)

A TypeScript trading bot for the [make.fun](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
bounty **"Pump.fun Replay Sprint — Paper Bot, Real Ranking"**. It trades
10 SOL of paper money on a 24-hour pump.fun replay and is ranked by net
PnL after fees.

## Strategy (one paragraph)

Small early tickets on creator-backed launches (creator bought ≥ 5 SOL,
≥ 8 distinct buyers, first ~100 slots), held with the scanner-proven exit
ladder (scale-out, stepped stop-loss, 20–25% trail, early exit, LP-drain
exit); survivors that reach 30 SOL real reserve get topped up to 0.20 SOL
for the completion run (pump.fun completes at exactly 85 SOL). See
[STRATEGY.md](STRATEGY.md) for the full design, the scanner mapping, and
the honest validation numbers.

## Local validation (dev window, all 3 parts, kit's own sim)

```
net +0.060 SOL after fees   fills 335   coins 88   trips 166
wins 21   max drawdown 0.013   rejected 0   failed txs 8
```

Guardrails: 88 coins ≥ 20, 166 round trips ≥ 0.01 SOL, drawdown 0.013 ≤
0.50. Caveat: the positive number is lottery-driven (one coin, 26wNSX,
+0.195 SOL); per-part results are −0.107 / +0.148 / −0.060 SOL. The final
window is fresh data.

## Run the backtest

```sh
# from the repo root; <kit> is the downloaded competition kit directory
node tools/backtest.ts <kit>
node tools/sweep.ts <kit>   # parameter sweep (dataset loaded once)
```

The grader runs `node /bot/main.ts` (Node 22, no dependencies beyond the
vendored SDK shim in `vendor/`).

## License

MIT — see [LICENSE](LICENSE).
