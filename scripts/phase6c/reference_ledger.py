"""Independent integer accounting and historical JSON identities. No application imports."""

from collections import deque
from decimal import Decimal
from functools import lru_cache
from operator import ge, gt, le, lt
from hashlib import sha256
import json
from pathlib import Path
import sys

REFERENCES = Path(__file__).resolve().parents[2] / "tests" / "reference"
sys.path.insert(0, str(REFERENCES))
from shared_pool_reference import U, fmt, quote, ratio as ratio, units, up


def equal(actual, expected, label):
    if actual != expected:
        raise ValueError(label + " differs from independent reference")


def number(value):
    """ECMAScript decimal notation for a shortest round-trip finite binary64 number."""
    if not isinstance(value, float):
        return str(value)
    if not value:
        return "0"
    digits = Decimal(repr(value))
    if Decimal("1e-6") <= abs(digits) < Decimal("1e21"):
        text = format(digits, "f")
        return text.rstrip("0").rstrip(".") if "." in text else text
    mantissa, exponent = format(digits.normalize(), "e").split("e")
    return f"{mantissa}e{int(exponent):+d}"


def historical_hash(value):
    digest = sha256()
    pieces = []

    def emit(token):
        pieces.append(token)
        if len(pieces) >= 4096:
            digest.update("".join(pieces).encode("ascii"))
            pieces.clear()

    def encode(item):
        if isinstance(item, dict):
            emit("{")
            for i, key in enumerate(sorted(item, key=lambda k: k.encode("utf-16-be", "surrogatepass"))):
                if i:
                    emit(",")
                emit(json.dumps(key, ensure_ascii=True))
                emit(":")
                encode(item[key])
            emit("}")
        elif isinstance(item, list):
            emit("[")
            for i, child in enumerate(item):
                if i:
                    emit(",")
                encode(child)
            emit("]")
        elif isinstance(item, (int, float)) and type(item) is not bool:
            emit(number(item))
        else:
            emit(json.dumps(item, ensure_ascii=True, allow_nan=False))

    encode(value)
    digest.update("".join(pieces).encode("ascii"))
    return digest.hexdigest()


def data_hash(dataset, candles):
    tape = [
        {key: (v if key == "timestampUtcMs" else number(v)) for key, v in candle.items()}
        for candle in candles
    ]
    return historical_hash(
        {"symbol": dataset["symbol"], "intervalMs": dataset["parsing"]["intervalMs"], "candles": tape}
    )


def signals(candles, strategy):
    prices = [float(c["close"]) for c in candles]
    atoms = [units(number(c["close"])) for c in candles]
    sums = [0]
    for price in atoms:
        sums.append(sums[-1] + price)

    def blend(a, b, w):
        # Historical binary64 rounds products and sums separately.
        return a + (b - a) * w if b >= a else b + (a - b) * (1 - w)

    @lru_cache(None)
    def average(kind, n):
        if kind == "MA":
            # Return scaled sums so comparisons do not round a quotient.
            return [None if i + 1 < n else sums[i + 1] - sums[i + 1 - n] for i in range(len(prices))]
        if kind != "EMA":
            raise ValueError("unknown average " + kind)
        out = []
        mean = 0.0
        for i, price in enumerate(prices):
            mean = blend(mean, price, 1 / (i + 1) if i < n else 2 / (n + 1))
            out.append(mean if i + 1 >= n else None)
        return out

    @lru_cache(None)
    def rsi(n):
        out = [None]
        gain = loss = 0.0
        for i in range(1, len(prices)):
            delta = prices[i] - prices[i - 1]
            pos, neg = max(delta, 0), max(-delta, 0)
            if i <= n:
                gain, loss = blend(gain, pos, 1 / i), blend(loss, neg, 1 / i)
            else:
                gain, loss = gain * ((n - 1) / n) + pos / n, loss * ((n - 1) / n) + neg / n
            out.append(
                None
                if i < n
                else (
                    50
                    if gain == loss == 0
                    else 100
                    if loss == 0
                    else 0
                    if gain == 0
                    else 100 / (1 + loss / gain)
                )
            )
        return out

    @lru_cache(None)
    def extreme(n, above):
        queue = deque()
        out = []
        for i, bar in enumerate(candles):
            while queue and queue[0][0] < i - n:
                queue.popleft()
            out.append(queue[0][1] if i >= n else None)
            current = units(number(bar["high" if above else "low"]))
            while queue and ((queue[-1][1] <= current) if above else (queue[-1][1] >= current)):
                queue.pop()
            queue.append((i, current))
        return out

    def crossed(kind, fast, slow, i, direction):
        f, s = average(kind, fast), average(kind, slow)
        if i == 0 or s[i - 1] is None:
            return None

        def relation(pos):
            return f[pos] * slow - s[pos] * fast if kind == "MA" else f[pos] - s[pos]

        old, new = relation(i - 1), relation(i)
        return old <= 0 < new if direction == "above" else old >= 0 > new

    def condition(c, i):
        kind = c["kind"]
        if kind == "cross":
            return crossed(c["average"], c["fastPeriod"], c["slowPeriod"], i, c["direction"])
        if kind == "breakout":
            above = c["direction"] == "above"
            threshold = extreme(c["lookback"], above)[i]
            return None if threshold is None else (atoms[i] > threshold if above else atoms[i] < threshold)
        op = {"gt": gt, "gte": ge, "lt": lt, "lte": le}[c["operator"]]
        if kind == "price-ma":
            kind, n = c["average"], c["period"]
            avg = average(kind, n)[i]
            return None if avg is None else op(atoms[i] * n if kind == "MA" else prices[i], avg)
        if kind == "rsi":
            value = rsi(c["period"])[i]
            return None if value is None else op(value, c["threshold"])
        raise ValueError("unknown rule condition " + kind)

    def group(g, i):
        if not g["enabled"]:
            return False
        values = [condition(c, i) for c in g["conditions"] if c["enabled"]]
        return None if None in values else (all(values) if g["operator"] == "AND" else any(values))

    previous_match = False, False
    result = []
    for i in range(len(candles)):
        action, reason = "hold", "warmup"
        kind = strategy["kind"]
        if kind == "ma":
            fast, slow = strategy["fastPeriod"], strategy["slowPeriod"]
            up = crossed("MA", fast, slow, i, "above")
            if up is not None:
                if up:
                    action, reason = "buy", "ma-cross-up"
                elif crossed("MA", fast, slow, i, "below"):
                    action, reason = "sell", "ma-cross-down"
                else:
                    reason = "ma-no-cross"
        elif kind == "rsi":
            value = rsi(strategy["period"])[i]
            if value is not None:
                if value <= strategy["lower"]:
                    action, reason = "buy", "rsi-lower"
                elif value >= strategy["upper"]:
                    action, reason = "sell", "rsi-upper"
                else:
                    reason = "rsi-middle"
        elif kind == "breakout":
            high, low = extreme(strategy["lookback"], True)[i], extreme(strategy["lookback"], False)[i]
            if high is not None:
                if atoms[i] > high:
                    action, reason = "buy", "breakout-up"
                elif atoms[i] < low:
                    action, reason = "sell", "breakout-down"
                else:
                    reason = "breakout-inside"
        elif kind == "rules":
            rule = strategy["rule"]
            buy, sell = group(rule["buy"], i), group(rule["sell"], i)
            reason = "rules-warmup"
            if buy is not None and sell is not None:
                if buy and sell:
                    reason = "rules-conflict"
                elif buy and not previous_match[0]:
                    action, reason = "buy", "rules-buy"
                elif sell and not previous_match[1]:
                    action, reason = "sell", "rules-sell"
                else:
                    reason = "rules-repeat" if buy or sell else "rules-no-match"
                previous_match = buy, sell
        else:
            raise ValueError("unknown strategy " + kind)
        item = dict(candleIndex=i, action=action, reason=reason)
        if action != "hold":
            item["quantity"] = "all"
        result.append(item)
    return result


def run_ledger(candles, config, interval, decisions, *, risk=None, interactive=False):
    entry = None
    risk = risk or {}
    cash = units(config["initialCash"])
    qty = 0
    fills, orders, closes = [], [], []
    decisions_by_bar = {s["candleIndex"]: s for s in decisions if s["action"] != "hold"}
    if any(i < 0 or i >= len(candles) for i in decisions_by_bar):
        raise ValueError("decision outside supplied history")
    pending = None
    totals = {k: 0 for k in ("buyNotional", "sellNotional", "fees", "buyQuantity", "sellQuantity")}

    def account(mark):
        mv = qty * mark // U
        return dict(
            cash=fmt(cash),
            position={"quantity": fmt(qty)},
            markPrice=fmt(mark),
            marketValue=fmt(mv),
            equity=fmt(cash + mv),
        )

    def execute(pending, i, price, time):
        nonlocal cash, qty, entry
        buy = pending["side"] == "buy"
        requested = pending["quantity"]
        limit = cash if buy else qty
        if ((not interactive or risk) and buy and qty) or (not interactive and not buy and not qty):
            fill = "position-already-open" if buy else "position-already-flat"
        elif requested == "all":
            fill = quote(buy, price, limit, config)
        else:
            tick = 10 ** (18 - config["quantityDecimals"])
            q = units(requested) // tick * tick
            slip = config["buySlippageBps"] if buy else -config["sellSlippageBps"]
            cost = up(price * (10000 + slip), 10000) if buy else price * (10000 + slip) // 10000
            notional = up(cost * q, U) if buy else cost * q // U
            fee = up(notional * config["feeBps"], 10000)
            if not cost:
                fill = "price-underflow"
            elif not q:
                fill = "zero-quantity"
            elif not notional:
                fill = "zero-notional"
            elif notional < units(config["minNotional"]):
                fill = "below-min-notional"
            elif buy and notional + fee > cash:
                fill = "insufficient-cash"
            elif not buy and q > qty:
                fill = "insufficient-position"
            else:
                fill = (cost, q, notional, fee)
        if isinstance(fill, str):
            orders.append(dict(intent=pending, status="rejected", reason=fill, resolvedUtcMs=time))
        else:
            p, q, n, fee = fill
            sign = 1 if buy else -1
            before = account(price)
            cash -= sign * n + fee
            qty += sign * q
            if buy:
                entry = p
            elif qty == 0:
                entry = None
            after = account(price)
            side = pending["side"]
            totals[side + "Notional"] += n
            totals[side + "Quantity"] += q
            totals["fees"] += fee
            fills.append(
                dict(
                    sequence=len(fills) + 1,
                    orderId=pending["id"],
                    side=side,
                    reason=pending["reason"],
                    signalCandleIndex=pending["signalCandleIndex"],
                    candleIndex=i,
                    timestampUtcMs=time,
                    referencePrice=fmt(price),
                    price=fmt(p),
                    quantity=fmt(q),
                    notional=fmt(n),
                    fee=fmt(fee),
                    before=before,
                    after=after,
                    delta=dict(
                        cash=fmt(-sign * n - fee),
                        quantity=fmt(sign * q),
                        equity=fmt(units(after["equity"]) - units(before["equity"])),
                    ),
                    totals={k: fmt(v) for k, v in totals.items()},
                )
            )
            if "trigger" in pending:
                fills[-1]["trigger"] = pending["trigger"]
            orders.append(dict(intent=pending, status="filled", resolvedUtcMs=time))

    def protection(bar, i, phase):
        if not (risk and entry and qty):
            return False
        low = units(number(bar["open"] if phase == "open" else bar["low"]))
        high = units(number(bar["open"] if phase == "open" else bar["high"]))
        stop = entry * (10000 - risk["stopLossBps"]) // 10000 if "stopLossBps" in risk else None
        take = up(entry * (10000 + risk["takeProfitBps"]), 10000) if "takeProfitBps" in risk else None
        if stop == 0:
            raise ValueError("stop loss threshold underflow")
        hit_stop = stop is not None and low <= stop
        hit_take = take is not None and high >= take
        if not (hit_stop or hit_take):
            return False
        reason = "stop-loss" if hit_stop else "take-profit"
        price = (low if phase == "open" else stop) if hit_stop else take
        time = bar["timestampUtcMs"] if phase == "open" else None
        assumption = (
            "observed-open"
            if phase == "open"
            else "ambiguous-stop-first"
            if hit_stop and hit_take
            else "threshold-touch-order-unknown"
        )
        trigger = dict(
            entryPrice=fmt(entry),
            stopPrice=fmt(stop) if stop is not None else None,
            takePrice=fmt(take) if take is not None else None,
            phase=phase,
            kind=reason,
            assumption=assumption,
            barOpenUtcMs=bar["timestampUtcMs"],
            barCloseUtcMs=bar["timestampUtcMs"] + interval,
            referencePrice=fmt(price),
        )
        execute(
            dict(
                id=f"risk-{i}",
                side="sell",
                quantity="all",
                reason=reason,
                signalCandleIndex=None,
                generatedUtcMs=time,
                targetCandleIndex=i,
                trigger=trigger,
            ),
            i,
            price,
            time,
        )
        return True

    for i, bar in enumerate(candles):
        opened = bar["timestampUtcMs"]
        if protection(bar, i, "open"):
            if pending:
                orders.append(
                    dict(intent=pending, status="cancelled", reason="risk-priority", resolvedUtcMs=opened)
                )
        else:
            if pending:
                execute(pending, i, units(number(bar["open"])), opened)
            if not protection(bar, i, "open"):
                protection(bar, i, "intrabar")
        closes.append(
            dict(
                candleIndex=i, timestampUtcMs=opened + interval, account=account(units(number(bar["close"])))
            )
        )
        s = decisions_by_bar.get(i)
        pending = (
            dict(
                id=f"order-{i}",
                side=s["action"],
                quantity=s["quantity"],
                reason=s["reason"],
                signalCandleIndex=i,
                generatedUtcMs=opened + interval,
                targetCandleIndex=i + 1,
            )
            if s
            else None
        )
    if pending and not interactive:
        orders.append(
            dict(
                intent=pending,
                status="expired",
                reason="no-next-candle",
                resolvedUtcMs=pending["generatedUtcMs"],
            )
        )
        pending = None
    return dict(fills=fills, orders=orders, closes=closes, final=closes[-1]["account"]), pending


def run_identity(input_data, decisions):
    strategy = input_data["strategy"]
    versions = {
        "algorithmVersion": "spot-long-protected-next-open-v2",
        "conversionVersion": "number-shortest-decimal-fixed18-v1",
    }
    strategy_version = (
        "causal-declarative-rules-v1" if strategy["kind"] == "rules" else "causal-close-ma-rsi-breakout-v1"
    )
    dataset = input_data["dataset"]
    keys = dict(
        versions,
        dataHash=data_hash(dataset, dataset["candles"]),
        signalHash=historical_hash(decisions),
        config=input_data["config"],
        completedThroughUtcMs=input_data["completedThroughUtcMs"],
        strategy={"config": strategy, "version": strategy_version},
        risk=input_data["risk"],
    )
    return {**keys, "runHash": historical_hash(keys)}


def simulate(input_data):
    dataset = input_data["dataset"]
    candles = dataset["candles"]
    decisions = signals(candles, input_data["strategy"])
    ledger, _ = run_ledger(
        candles, input_data["config"], dataset["parsing"]["intervalMs"], decisions, risk=input_data["risk"]
    )
    return decisions, ledger
