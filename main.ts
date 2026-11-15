// DipCatcher — a cbBTC dip-buying bot for make.fun's btc-race-24h-20261115-0828.
//
// Idea, in one sentence: sharp hourly drops in BTC bounce, so buy the drop
// once the minute turns up, ride the bounce for up to two hours, and let a
// trailing stop keep the profit.
//
// Why this shape (found by grading the kit's own baselines and a local
// backtest against the exact fill math in the harness source):
//   - The dev window falls 3.9% over 24h, so buy-and-hold loses ~$44 and
//     every kit baseline loses money (best is hold-cash at $0). A long-only
//     bot can only make money by catching the bounces inside the fall.
//   - After a 60-minute drop of 1.5% or more, the next 60 minutes average
//     +1.4% (median +1.2%, positive 70% of the time). After a 30-minute
//     drop there is no edge, and after a 60-minute rise there is none
//     either — momentum does not persist at these horizons here. RSI and
//     Bollinger dip-buying also lose: the dips keep dipping, and fixed
//     take-profit / stop-loss exits cut the one bounce that pays.
//   - So the entry is a sharp 60-minute drop, the exit is time (2h) plus a
//     trailing stop that only arms once the trade is up 0.5%. No fixed
//     take-profit, no fixed stop-loss: both were tested and both destroy
//     the edge on this window.
//
// Rules (all integer math, no clock, no randomness, fully deterministic):
//   - Entry, flat only: the close is at least 1.8% below the close 60 bars
//     ago AND the latest close is not below the previous close (the minute
//     has stopped falling). Buy with all the cash.
//   - Exit, while holding: sell everything when the position's value has
//     fallen 0.5% below its peak value since entry, once that peak was at
//     least 0.5% above cost; or 120 bars after the fill, whichever first.
//   - One position at most, long only, full size. Slippage is left wide
//     open (10,000 bps) so a fill is never refused for gapping: the fill
//     math (4 bps fee, 2 bps slippage, pool impact) is already priced in.
//
// Dev-window grade (kit's own grader, grade-local --driver process):
//   net PnL +$39.16, 2 round trips, both wins (win rate 1.0), max drawdown
//   1.93%, fees $1.62, exposure 10.6% of the window. Per-trip PnL: +$0.74
//   on the first drop event, +$38.42 on the day's big V (a -2.8% 60-minute
//   plunge to $62,082, then a +4.7% bounce). The parameter neighbourhood
//   is flat, not a spike: drop 1.6-2.0%, hold 90-180 bars and trail
//   0.4-0.7% are all profitable on the dev window, so this is a region,
//   not an overfitted point.
//
// What it buys, in plain words: it buys cbBTC only right after a sharp
// one-hour fall, when the latest minute has just stopped falling. It is
// betting that the fall was an overreaction and the price bounces back
// over the next hour or two — on the dev window, after a 60-minute drop
// of 1.5% or more, the next 60 minutes averaged +1.4%. It never buys
// while the price is still falling, never buys a slow bleed (only sharp
// drops qualify), and never holds longer than two hours. It exits in
// exactly two ways, whichever comes first: the price falls 0.5% from the
// best value the trade reached, but only after the trade was already up
// at least 0.5% (so the stop protects a real gain instead of cutting a
// trade that never got going); or two hours pass after the buy. There is
// no fixed profit target and no fixed stop-loss — both were tested and
// both cut the one bounce that pays. At most one position, long only,
// full cash in, everything out on exit.

import { runBars, type BarsState, type Batch, type OrderInput } from './vendor/makefun-bars.ts';

/** Bars of history a 60-minute drop is measured over (one hour of 1-min bars). */
const LOOKBACK_BARS = 60;
/**
 * Entry trigger: 60-bar return at or below -180 bps (-1.8%). A -1.8% hourly
 * drop is roughly a 2-sigma event at current volatility, so it fires rarely
 * (3 clustered events on the dev window) and only on sharp falls, not slow
 * bleeds. Backtest: after drops of 1.5%+ the next hour averages +1.4%;
 * the whole 1.6-2.0% band is profitable, so 1.8% is a region pick.
 */
const DROP_BPS = 180n;
/**
 * Time exit: sell 120 bars (2 hours) after the fill bar. Two hours is long
 * enough to ride the bounce but short enough to be flat before the next
 * drop; the 90-180 bar band is all profitable on the dev window.
 */
const HOLD_BARS = 120;
/**
 * Trailing stop: sell once the position value has fallen 50 bps (0.5%)
 * below its peak since entry. 0.5% is small enough to bank most of a
 * bounce before it rolls over, and the 0.4-0.7% band is all profitable.
 */
const TRAIL_BPS = 50n;
/**
 * Arm for the trailing stop: it only starts watching once the peak value
 * is 50 bps (0.5%) above cost. Until the trade is actually up, there is
 * nothing to protect, so an early dip never triggers a sale.
 */
const TRAIL_ARM_BPS = 50n;
/** Wide open, as in the kit's momentum baseline: a fill is never refused. */
const MAX_SLIPPAGE_BPS = 10_000;

const BPS = 10_000n;

/** Every close so far, oldest first, as raw price integers. */
const closes: bigint[] = [];
/** Seq of the batch on which the current position first appeared (-1 flat). */
let entrySeq = -1;
/** Highest position value (quote units) seen since entry. */
let peakValue = 0n;

let symbol = 'CBBTC';

await runBars({
  onHello(state: BarsState): void {
    // One asset in this universe; take its ticker from hello, not from memory.
    if (state.hello.symbols.length > 0) symbol = state.hello.symbols[0].symbol;
  },

  onBatch(state: BarsState, _batch: Batch): OrderInput[] {
    const close = state.close(symbol);
    if (close !== null) closes.push(close);

    const pos = state.positions.get(symbol);
    if (pos !== undefined) {
      if (entrySeq < 0) {
        // The buy filled on this batch's bar; start the clock here.
        entrySeq = state.seq;
        peakValue = 0n;
      }
      const value = state.value(symbol, pos.qty);
      if (value > peakValue) peakValue = value;
      const cost = pos.cost;
      const armed = peakValue * BPS >= cost * (BPS + TRAIL_ARM_BPS);
      const trailed = armed && value * BPS <= peakValue * (BPS - TRAIL_BPS);
      const expired = state.seq - entrySeq >= HOLD_BARS;
      if (trailed || expired) {
        entrySeq = -1;
        peakValue = 0n;
        return [{ side: 'sell', symbol, qty: pos.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }
    entrySeq = -1;
    peakValue = 0n;

    if (state.warmingUp) return [];
    if (closes.length < LOOKBACK_BARS + 1) return [];

    const now = closes[closes.length - 1];
    const then = closes[closes.length - 1 - LOOKBACK_BARS];
    const prev = closes[closes.length - 2];
    // now <= then * (1 - 1.8%), exactly, in integers.
    const dropped = now * BPS <= then * (BPS - DROP_BPS);
    // The minute has stopped falling.
    const turningUp = now >= prev;
    if (!dropped || !turningUp) return [];

    const cash = state.cash;
    if (cash < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    return [{ side: 'buy', symbol, notional_quote_units: cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  },
});
