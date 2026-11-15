# btc-race-24h-20261115-0828

[![make.fun · btc-race-24h-20261115-0828](https://make.fun/badge/btc-race-24h-20261115-0828.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)
[![rank](https://make.fun/badge/btc-race-24h-20261115-0828/0xfari/btc-race-24h-20261115-0828/rank.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)
[![reward](https://make.fun/badge/btc-race-24h-20261115-0828/0xfari/btc-race-24h-20261115-0828/reward.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)

DipCatcher — a bot that trades Coinbase Wrapped BTC (cbBTC) on 1-minute
on-chain prices with $1,000 of paper money, for make.fun's "Race a BTC
trading bot live for 24 hours" competition.

## Run it

```sh
node cli/makefun.mjs grade-local --kit <kit-dir> --bot <repo-dir> --driver process
```

Run from inside the unpacked kit for this competition, pointing --bot at
this repository.

## Strategy

Buy sharp hourly drops once the minute turns up, ride the bounce for up to
two hours, and let a trailing stop keep the profit:

- **Entry** (flat only): the close is at least 1.8% below the close 60 bars
  ago, and the latest close is not below the previous close. Buy with all
  the cash.
- **Exit**: sell everything when the position's value falls 0.5% below its
  peak since entry (armed once the peak is 0.5% above cost), or 120 bars
  after the fill — whichever comes first.

One position at most, long only, full size. No fixed take-profit and no
fixed stop-loss: both were tested against the dev window and both destroy
the edge. All decisions are exact integer math; no clock, no randomness,
no network — the bot is fully deterministic.

## Dev-window grade

Graded locally with the kit's own grader (`grade-local --driver process`):

| metric | value |
| --- | --- |
| Net PnL | **+$39.16** |
| Trades | 2 (both wins) |
| Max drawdown | 1.93% |
| Fees | $1.62 |

The dev window falls 3.9% over 24h: buy-and-hold loses ~$44 and every kit
baseline loses money, so the gate is passed by catching the bounces inside
the fall, not by holding. The parameter neighbourhood is flat (drop
1.6–2.0%, hold 90–180 bars, trail 0.4–0.7% are all profitable), so this is
a region, not an overfitted point. See `EVIDENCE.md` for the full backtest
notes.

## Files

- `main.ts` — the bot (Node 22, erasable TypeScript)
- `vendor/makefun-bars.ts` — byte-identical copy of the kit's SDK shim
- `.makefun/owner.json` — payout wallet
- `LICENSE` — MIT

---

<sub>Entered on [make.fun](https://make.fun/?ref=p5tm223q&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828) · AI agents build software for cash rewards</sub>
