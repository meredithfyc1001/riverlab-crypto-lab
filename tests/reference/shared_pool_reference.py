"""Independent synthetic Phase 5C-B oracle in integer quote/base atoms (10^-18).
No TypeScript, browser, generated strategies, previous fixtures or engine output.
Use --check to verify the committed vectors; the default writes these vectors.
"""
import argparse
import json
from dataclasses import dataclass
from decimal import Decimal, localcontext
from pathlib import Path

U = 10**18
START = 1735689600000
MINUTE = 60_000


def units(v):
    return int(Decimal(str(v)) * U)


def fmt(n, places=18):
    sign = "-" if n < 0 else ""
    whole, tail = divmod(abs(n), 10**places)
    fraction = f"{tail:0{places}d}".rstrip("0")
    return sign + str(whole) + ("." + fraction if fraction else "")


def ratio(n, d):
    return fmt((-1 if n < 0 else 1) * (abs(n) * 10**12 // d), 12)


def up(a, b):
    return -(-a // b)


def asset(name, weight, tape, *, fee=0, buy=0, sell=0, decimals=18, minimum="0",
          stop=None, take=None):
    # Compact artificial bars use an equal OHLC when only one value is given.
    return dict(symbol=name + "/USDT", weightPercent=str(weight),
                bars=[list(b) if isinstance(b, tuple) else [b] * 4 for b in tape],
                costs=dict(feeBps=fee, buySlippageBps=buy, sellSlippageBps=sell,
                           quantityDecimals=decimals, minNotional=minimum),
                risk={k: v for k, v in [("stopLossBps", stop), ("takeProfitBps", take)]
                      if v is not None})


def case(name, assets, *, capital="1000", every=0, reserve="0"):
    return dict(name=name, initialCash=capital, rebalanceEvery=every,
                cashWeightPercent=reserve, assets=assets)


def scenarios():
    # AAA establishes a position before the other four simultaneously signal;
    # its price appreciation makes those nominal requests exceed available cash.
    competition = case("five-way-clock", [
        asset("AAA", 50, [90, 95, 100, 250, 311, 280, 260], fee=13, buy=7, sell=3),
        asset("BBB", 20, [13, 13, 13, 15, 17, 19, 14], fee=31, buy=21, decimals=8),
        asset("CCC", 15, [17, 17, 17, 19, 20, 21, 18], decimals=3, minimum="120"),
        asset("DDD", 5, [2, 2, 2, 3, 5, 8, 7], fee=19, decimals=2),
        asset("EEE", 5, [5, 5, 5, 7, 9, 8, 5], minimum="55"),
    ], capital="1000.000000000000000013")
    # At open 5 the prior sell for AAA and buys for BBB/CCC coexist. AAA
    # sells before any opening budget is frozen, even in reverse display order.
    rotate = case("sell-proceeds", [
        asset("AAA", 55, [90, 95, 100, 300, 240, 260, 270], fee=23, sell=41),
        asset("BBB", 25, [15, 15, 15, 15, 19, 20, 22], fee=1, decimals=5),
        asset("CCC", 20, [25, 25, 25, 25, 27, 29, 28], decimals=0),
    ])
    late = case("late-dual-trigger", [
        asset("AAA", 60, [90, 95, 100, 115, (140, 155, 85, 136), 137],
              stop=1000, take=5000),
        asset("BBB", 40, [27, 27, 27, 30, 32, 35], fee=13, decimals=4),
    ])
    gap = case("gap-protects-first", [
        asset("AAA", 60, [90, 95, 100, 110, 154, 155], stop=1000, take=5000),
        asset("BBB", 40, [25, 25, 25, 30, 32, 35]),
    ])
    failed = case("failed-protection", [
        asset("AAA", 50, [10, 12, 10, 8, 7, 6], minimum="450", stop=1000),
        asset("BBB", 40, [20, 20, 20, 22, 23, 22], fee=67),
    ])
    periodic = case("partial-rebalance", [
        asset("AAA", "55.125", [19, 20, 24, 29, 45, 40, 11, 15, 33],
              fee=17, buy=21, sell=13, decimals=4),
        asset("BBB", "34.875", [40, 33, 35, 49, 24, 19, 59, 39, 12],
              fee=32, buy=11, sell=23, decimals=5),
    ], capital="1234.567890123456789023", every=2, reserve="10")
    imprecise = case("indivisible-and-minimum", [
        asset("AAA", 30, [15, 11, 19, 12], decimals=0),
        asset("BBB", 50, [7, 9, 5, 13], minimum="17.5", fee=10),
    ], capital="25.000000000000000001", every=1, reserve="20")
    tiny = case("five-atoms-fee-ceiling", [
        asset("AAA", 40, [0.25, 0.75, 1, 0.25], fee=1),
        asset("BBB", 40, [0.25, 0.5, 0.5, 0.75], fee=9999),
    ], capital="0.000000000000000005", every=1, reserve="20")
    locked = case("cash-reserve-exhausted", [
        asset("AAA", 55, [90, 95, 100, 200, 400, 410]),
        asset("BBB", 5, [9, 9, 9, 10, 12, 13]),
    ])
    depleted = case("no-cash-left", [
        asset("AAA", 40, [90, 95, 100, 200, 1000, 1000]),
        asset("BBB", 30, [9, 9, 9, 11, 12, 12]),
        asset("CCC", 30, [15, 15, 15, 15, 20, 18]),
    ])
    return [competition, rotate, late, gap, failed, periodic, imprecise, tiny, locked, depleted]


@dataclass
class Account:
    quantity: int = 0
    bought: int = 0
    sold: int = 0
    fees: int = 0
    entry: int = 0


def quote(buy, ref, limit, costs):
    """Invert exact affordability analytically. For integer N, N+ceil(N*f/B)<=C
    iff N*(B+f)<=C*B. Thus there is no fee guess or quantity search."""
    tick = 10 ** (18 - costs["quantityDecimals"])
    fee_rate = costs["feeBps"]
    price = (up(ref * (10_000 + costs["buySlippageBps"]), 10_000) if buy else
             ref * (10_000 - costs["sellSlippageBps"]) // 10_000)
    if not price:
        return "price-underflow"
    max_notional = limit * 10_000 // (10_000 + fee_rate)
    qty = ((max_notional * U // price if buy else limit) // tick) * tick
    if not qty:
        return "zero-quantity"
    notional = up(price * qty, U) if buy else (price * qty) // U
    fee = up(notional * fee_rate, 10_000)
    if not notional:
        return "zero-notional"
    if notional < units(costs["minNotional"]):
        return "below-min-notional"
    if buy:
        assert notional + fee <= limit
        next_notional = up(price * (qty + tick), U)
        assert next_notional + up(next_notional * fee_rate, 10_000) > limit
    return price, qty, notional, fee


def prorate(requests, capacity):
    total = sum(requests)
    if total <= capacity:
        return requests[:]
    grants = [r * capacity // total for r in requests]
    extra = capacity - sum(grants)
    for i, wanted in enumerate(requests):  # canonical symbol order
        if extra and grants[i] < wanted:
            grants[i] += 1
            extra -= 1
    assert extra == 0
    return grants


def protect(account, risk, bar, at_open):
    if not account.quantity or not risk:
        return None
    op, hi, lo, _ = bar
    stop = (account.entry * (10_000 - risk["stopLossBps"]) // 10_000
            if "stopLossBps" in risk else None)
    take = (up(account.entry * (10_000 + risk["takeProfitBps"]), 10_000)
            if "takeProfitBps" in risk else None)
    if stop is not None and (op if at_open else lo) <= stop:
        return op if at_open else stop
    if take is not None and (op if at_open else hi) >= take:
        return take
    return None


def simulate(spec, *, signal_tapes=None):
    # The committed 5C-B vectors use the fixed one-bar breakout. A migration
    # supplies decisions independently regenerated from each original strategy.
    # Preserve the older vector projection while auditing every live round.
    audit_history = signal_tapes is not None
    allocations = []
    benchmark_reasons = []
    inputs = sorted(spec["assets"], key=lambda a: a["symbol"])
    symbols = [a["symbol"] for a in inputs]
    tapes = [[[units(p) for p in candle] for candle in a["bars"]] for a in inputs]
    weights = [units(a["weightPercent"]) for a in inputs]
    initial = cash = units(spec["initialCash"])
    every = spec["rebalanceEvery"]
    reserve = 100 * U - sum(weights)
    indices = range(len(inputs))
    holdings = [Account() for _ in inputs]
    passive_cash = initial
    passive_qty = [0 for _ in inputs]
    benchmark_rejects = []
    for j in indices:
        if not weights[j]:
            continue
        allocation = initial * weights[j] // (100 * U)
        fill = quote(True, tapes[j][0][0], allocation, inputs[j]["costs"])
        if isinstance(fill, str):
            benchmark_rejects.append(symbols[j])
            benchmark_reasons.append(dict(symbol=symbols[j], reason=fill))
        else:
            _, passive_qty[j], notional, fee = fill
            passive_cash -= notional + fee

    peak = initial
    worst_num, worst_den = 0, 1
    fills, rejects, grants, curve, rebalances = [], [], [], [], []
    signals = ["hold" for _ in inputs]

    def weights_at(prices):
        values = [a.quantity * p // U for a, p in zip(holdings, prices)]
        equity = cash + sum(values)
        return [fmt(v * 100 * U // equity) if equity else None for v in values + [cash]]

    def mark(prices, passive):
        nonlocal peak, worst_num, worst_den
        values = [a.quantity * p // U for a, p in zip(holdings, prices)]
        equity = cash + sum(values)
        peak = max(peak, equity)
        drop = peak - equity
        if drop * worst_den > worst_num * peak:
            worst_num, worst_den = drop, peak
        pnl = [a.sold - a.bought + v for a, v in zip(holdings, values)]
        assert sum(pnl) == equity - initial
        curve.append(dict(cash=fmt(cash), equity=fmt(equity), marketValue=fmt(sum(values)),
                          benchmarkEquity=fmt(passive), contributions=list(map(fmt, pnl)),
                          drawdown=ratio(drop, peak), weights=weights_at(prices)))

    def trade(j, buy, phase, ref, limit):
        nonlocal cash
        a = holdings[j]
        result = quote(buy, ref, limit, inputs[j]["costs"])
        stop = inputs[j]["risk"].get("stopLossBps", 0)
        if buy and stop and not isinstance(result, str) and result[0] * (10_000-stop) // 10_000 == 0:
            result = "stop-price-underflow"
        if isinstance(result, str):
            rejects.append(dict(barIndex=i, symbol=symbols[j], phase=phase, rejection=result))
            return
        price, qty, notional, fee = result
        before_cash, before_qty = cash, a.quantity
        a.fees += fee
        if buy:
            a.quantity += qty
            a.bought += notional + fee
            cash -= notional + fee
            a.entry = price
        else:
            assert qty <= a.quantity
            a.quantity -= qty
            a.sold += notional - fee
            cash += notional - fee
        assert min(cash, a.quantity) >= 0
        assert cash == initial + sum(h.sold - h.bought for h in holdings)
        fills.append(dict(barIndex=i, symbol=symbols[j], phase=phase, side="buy" if buy else "sell",
                          price=fmt(price), quantity=fmt(qty), notional=fmt(notional), fee=fmt(fee),
                          cashBefore=fmt(before_cash), cashAfter=fmt(cash),
                          quantityBefore=fmt(before_qty), quantityAfter=fmt(a.quantity)))

    mark([0] * len(inputs), initial)
    for i, bars in enumerate(zip(*tapes)):
        opens = [b[0] for b in bars]
        closes = [b[3] for b in bars]
        rebalance = every and i > 0 and i % every == 0
        before_weights = weights_at(opens)
        blocked = set()
        for j in indices:
            ref = protect(holdings[j], inputs[j]["risk"], bars[j], True)
            if ref is not None:
                trade(j, False, "protection-open", ref, holdings[j].quantity)
                blocked.add(j)

        values = [h.quantity * p // U for h, p in zip(holdings, opens)]
        pre_equity = cash + sum(values)
        for j in indices:
            target = pre_equity * weights[j] // (100 * U)
            if rebalance and values[j] > target:
                sell_qty = (values[j] - target) * U // opens[j]
                trade(j, False, "sell", opens[j], sell_qty)
            elif not every and signals[j] == "sell":
                if j not in blocked and holdings[j].quantity:
                    trade(j, False, "sell", opens[j], holdings[j].quantity)
                elif audit_history:
                    reason = "risk-priority" if j in blocked else "position-already-flat"
                    rejects.append(dict(barIndex=i, symbol=symbols[j], phase="sell", rejection=reason))

        values = [h.quantity * p // U for h, p in zip(holdings, opens)]
        equity = cash + sum(values)
        available = max(0, cash - equity * reserve // (100 * U))
        requests = []
        for j in indices:
            eligible = rebalance or (not every and signals[j] == "buy"
                                      and j not in blocked and holdings[j].quantity == 0)
            shortfall = equity * weights[j] // (100 * U) - values[j]
            requests.append(max(shortfall, 0) if eligible else 0)
        approvals = prorate(requests, available)
        cash_before_buys = cash
        for j in indices:
            if requests[j]:
                grants.append(dict(barIndex=i, symbol=symbols[j], requestedBudget=fmt(requests[j]),
                                   approvedBudget=fmt(approvals[j])))
                if approvals[j]:
                    trade(j, True, "buy", opens[j], approvals[j])
                else:
                    reason = "cash-reserve" if equity * reserve // (100 * U) and available == 0 and cash_before_buys else "insufficient-cash"
                    rejects.append(dict(barIndex=i, symbol=symbols[j], phase="buy", rejection=reason))
            elif audit_history and not every and signals[j] == "buy":
                if holdings[j].quantity or j in blocked:
                    reason = "risk-priority" if j in blocked else "position-already-open"
                    rejects.append(dict(barIndex=i, symbol=symbols[j], phase="buy", rejection=reason))
                else:
                    trade(j, True, "buy", opens[j], 0)
        if audit_history and (rebalance or 'buy' in signals):
            allocations.append(dict(barIndex=i, openEquity=fmt(equity), cashBeforeBuys=fmt(cash_before_buys),
                                    reserve=fmt(equity * reserve // (100*U)), capacity=fmt(available),
                                    requested=fmt(sum(requests)), approved=fmt(sum(approvals)),
                                    spent=fmt(cash_before_buys-cash), cashAfterBuys=fmt(cash)))
        for j in indices:
            if j in blocked:
                continue
            ref = protect(holdings[j], inputs[j]["risk"], bars[j], True)
            if ref is None:
                ref = protect(holdings[j], inputs[j]["risk"], bars[j], False)
            if ref is not None:
                trade(j, False, "protection-after-buys", ref, holdings[j].quantity)

        if rebalance:
            after_weights = weights_at(opens)
            rebalances.append(dict(barIndex=i, beforePercent=before_weights, afterPercent=after_weights,
                                   deviationPercent=[fmt(units(w) - t) if w is not None else None
                                                     for w, t in zip(after_weights, weights + [reserve])]))
        passive = passive_cash + sum(q * p // U for q, p in zip(passive_qty, closes))
        mark(closes, passive)
        if audit_history and not every:
            signals = [signal_tapes[s][i]["action"] for s in symbols]
        elif i and not every:
            for j in indices:
                _, prior_high, prior_low, _ = tapes[j][i - 1]
                signals[j] = ("buy" if closes[j] > prior_high else
                              "sell" if closes[j] < prior_low else "hold")

    expected = dict(fills=fills, rejects=rejects, grants=grants, curve=curve, rebalances=rebalances,
                netPnl=fmt(units(curve[-1]["equity"]) - initial), fees=fmt(sum(a.fees for a in holdings)),
                maxDrawdown=ratio(worst_num, worst_den),
                benchmarkReturn=ratio(units(curve[-1]["benchmarkEquity"]) - initial, initial),
                benchmarkRejects=benchmark_rejects,
                assets=[dict(symbol=symbols[j], quantity=fmt(h.quantity), fees=fmt(h.fees),
                             buySpend=fmt(h.bought), sellProceeds=fmt(h.sold),
                             netPnl=curve[-1]["contributions"][j]) for j, h in enumerate(holdings)])
    if audit_history:
        expected.update(allocations=allocations, benchmarkReasons=benchmark_reasons)
    return expected


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    with localcontext() as ctx:
        ctx.prec = 120
        fixtures = [dict(spec=s, expected=simulate(s)) for s in scenarios()]
    path = Path(__file__).resolve().parents[1] / "fixtures" / "shared-pool-reference.json"
    if args.check:
        if fixtures != json.loads(path.read_text(encoding="utf-8")):
            raise SystemExit("Shared pool independent reference differs from fixture")
        count = sum(len(f["expected"]["fills"]) for f in fixtures)
        print(f"Shared pool integer oracle matched {len(fixtures)} paths and {count} fills.")
    else:
        path.write_text(json.dumps(fixtures, indent=2) + "\n", encoding="utf-8")
