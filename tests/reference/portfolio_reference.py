"""Phase 5C-A oracle. Artificial OHLC, independent Python Decimal accounting.
Run with --check to compare the committed fixture without changing any files.
"""
import argparse
import json
from decimal import Decimal as D, ROUND_CEILING, ROUND_DOWN, ROUND_FLOOR, localcontext
from pathlib import Path

QUANTUM = D("1e-18")
FRACTION = D("1e-12")
INITIAL = D("1000.000000000000000001")
START = 1735689600000
INTERVAL = 60000
ASSETS = [
    dict(symbol="AAA/USDT", weightPercent="40", lookback=1,
         prices=[10, 12, 11, 14, 9, 8, 10, 9, 15, 14, 12, 12],
         costs=dict(feeBps=25, buySlippageBps=17, sellSlippageBps=38,
                    quantityDecimals=8, minNotional="0")),
    dict(symbol="BBB/USDT", weightPercent="60", lookback=2,
         prices=[20, 19, 15, 16, 21, 22, 16, 13, 14, 17, 15, 14],
         costs=dict(feeBps=31, buySlippageBps=23, sellSlippageBps=13,
                    quantityDecimals=6, minNotional="0")),
]


def text(value):
    return format(value.normalize(), "f") if value else "0"


def rate(value):
    return text(value.quantize(FRACTION, rounding=ROUND_DOWN))


def allocate():
    exact = [INITIAL * D(a["weightPercent"]) / 100 for a in ASSETS]
    cash = [v.quantize(QUANTUM, rounding=ROUND_FLOOR) for v in exact]
    ranked = sorted(range(len(exact)),
                    key=lambda i: (-(exact[i] - cash[i]), ASSETS[i]["symbol"]))
    for i in ranked[:int((INITIAL - sum(cash)) / QUANTUM)]:
        cash[i] += QUANTUM
    return cash


def transaction(side, mark, cash, quantity, costs):
    buy = side == "buy"
    slip = costs["buySlippageBps"] if buy else -costs["sellSlippageBps"]
    mode = ROUND_CEILING if buy else ROUND_FLOOR
    price = (mark * (1 + D(slip) / 10000)).quantize(QUANTUM, rounding=mode)
    fee_rate = D(costs["feeBps"]) / 10000

    def charges(amount):
        notional = (price * amount).quantize(QUANTUM, rounding=mode)
        fee = (notional * fee_rate).quantize(QUANTUM, rounding=ROUND_CEILING)
        return notional, fee

    if buy:
        tick = D(1).scaleb(-costs["quantityDecimals"])
        amount = (cash / ((1 + fee_rate) * price)).quantize(tick, rounding=ROUND_FLOOR)
        while sum(charges(amount)) > cash:
            amount -= tick
        assert sum(charges(amount + tick)) > cash
    else:
        amount = quantity
    notional, fee = charges(amount)
    return ((cash - notional - fee, quantity + amount, fee) if buy
            else (cash + notional - fee, quantity - amount, fee))


def account(asset, initial):
    prices = list(map(D, asset["prices"]))
    costs = asset["costs"]
    cash, qty, fees = initial, D(0), D(0)
    passive_cash, passive_qty, _ = transaction("buy", prices[0], initial, D(0), costs)
    rows = []
    fill_count = 0
    for i, price in enumerate(prices):
        # Current open is available for execution. The breakout window and
        # signal belong to the preceding close; OHLC are equal in this tape.
        signal_i = i - 1
        if signal_i >= asset["lookback"]:
            window = prices[signal_i - asset["lookback"]:signal_i]
            signal_price = prices[signal_i]
            buy = signal_price > max(window) and qty == 0
            sell = signal_price < min(window) and qty > 0
            if buy or sell:
                cash, qty, fee = transaction("buy" if buy else "sell", price, cash, qty, costs)
                fees += fee
                fill_count += 1
        assert min(cash, qty) >= 0
        value = (qty * price).quantize(QUANTUM, rounding=ROUND_FLOOR)
        passive = passive_cash + (passive_qty * price).quantize(QUANTUM, rounding=ROUND_FLOOR)
        rows.append(dict(cash=cash, marketValue=value, equity=cash + value, benchmarkEquity=passive))
    return rows, fees, fill_count


def pearson(left, right):
    def returns(prices):
        return [((D(y) - x) / D(x)).quantize(D("1e-96"), rounding=ROUND_DOWN)
                for x, y in zip(prices, prices[1:])]

    xs, ys = returns(left), returns(right)
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    covariance = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    xx = sum((x - mx)**2 for x in xs)
    yy = sum((y - my)**2 for y in ys)
    return rate(covariance / (xx * yy).sqrt())


def drawdown(values):
    peak = values[0]
    deepest = D(0)
    for v in values:
        peak = max(peak, v)
        deepest = max(deepest, (peak - v) / peak)
    return deepest


def reference():
    cash = allocate()
    accounts = [account(a, c) for a, c in zip(ASSETS, cash)]
    curve = [dict(timestampUtcMs=START, cash=text(INITIAL), marketValue="0",
                  equity=text(INITIAL), benchmarkEquity=text(INITIAL))]
    for i, points in enumerate(zip(*(a[0] for a in accounts)), 1):
        totals = {k: text(sum(p[k] for p in points)) for k in points[0]}
        assert D(totals["cash"]) + D(totals["marketValue"]) == D(totals["equity"])
        curve.append(dict(timestampUtcMs=START + i * INTERVAL, **totals))
    equity = D(curve[-1]["equity"])
    max_dd = drawdown([D(row["equity"]) for row in curve])
    individual_dd = [drawdown([c] + [p["equity"] for p in rows])
                     for c, (rows, _, _) in zip(cash, accounts)]
    assert max_dd > 0 and rate(max_dd) != rate(sum(individual_dd) / len(individual_dd))
    assets = []
    for a, c, (rows, fees, fills) in zip(ASSETS, cash, accounts):
        assets.append(dict(**a, initialCash=text(c), fees=text(fees), fillCount=fills,
                           netPnl=text(rows[-1]["equity"] - c),
                           equityWeight=rate(rows[-1]["equity"] / equity),
                           holdingWeight=rate(rows[-1]["marketValue"] / equity),
                           equityCurve=[text(p["equity"]) for p in rows]))
    return dict(initialCash=text(INITIAL), assets=assets, curve=curve, netPnl=text(equity - INITIAL),
                fees=text(sum(a[1] for a in accounts)), fillCount=sum(a[2] for a in accounts),
                maxDrawdown=rate(max_dd), totalReturn=rate((equity - INITIAL) / INITIAL),
                benchmarkReturn=rate((D(curve[-1]["benchmarkEquity"]) - INITIAL) / INITIAL),
                crossCorrelation=pearson(ASSETS[0]["prices"], ASSETS[1]["prices"]))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    path = Path(__file__).resolve().parents[1] / "fixtures" / "portfolio-reference.json"
    with localcontext() as ctx:
        ctx.prec = 250
        result = reference()
    if args.check:
        assert json.loads(path.read_text(encoding="utf-8")) == result, "Portfolio fixture differs"
        print("Independent Decimal250 portfolio ledgers, drawdown, benchmark and Pearson matched.")
    else:
        path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
