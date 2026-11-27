"""Source-driven Python numerical cross-checks, independent of the application replay."""

from copy import deepcopy
from decimal import Decimal, localcontext
from itertools import product
from math import expm1, log, isfinite
import json
from reference_ledger import (
    U,
    equal,
    fmt,
    historical_hash,
    number,
    quote,
    ratio,
    run_identity,
    run_ledger,
    simulate,
    units,
    up,
)
import market_regime_reference as regime_reference
import risk_reference
import shared_pool_reference


def without(obj, *keys):
    return {k: v for k, v in obj.items() if k not in keys}


def select(obj, keys):
    return {k: obj[k] for k in keys}


def checked_subset(actual, expected, name):
    equal(select(actual, expected), expected, name)


def compare_rows(actual, expected, name):
    equal(len(actual), len(expected), name + " count")
    for i, (left, right) in enumerate(zip(actual, expected)):
        checked_subset(left, right, f"{name}[{i}]")


def original(db, kind, key):
    row = db.execute("SELECT body FROM records WHERE kind=? AND id=?", (kind, key)).fetchone()
    return json.loads(row[0]) if row else None


def check_dataset(d):
    bars = d["candles"]
    stamps = [c["timestampUtcMs"] for c in bars]
    for i, c in enumerate(bars):
        if min(c["open"], c["close"]) < c["low"] or max(c["open"], c["close"]) > c["high"] or c["volume"] < 0:
            raise ValueError(f"invalid historical OHLCV at bar {i}")
    if any(b <= a for a, b in zip(stamps, stamps[1:])):
        raise ValueError("historical timestamps are not strictly ascending")
    equal(d["quality"]["validRows"], len(bars), "valid row count")
    equal(d["quality"]["range"], {"startUtcMs": stamps[0], "endUtcMs": stamps[-1]}, "time range")
    return {
        "candles": len(bars),
        "sourceFileSha256": d["file"]["sha256"],
        "projectedSourceHash": historical_hash(d),
    }


def check_rule(rule):
    equal(rule["ruleHash"], historical_hash(rule["rule"]), "ruleHash")
    equal(rule["recordHash"], historical_hash(without(rule, "recordHash")), "recordHash")
    equal(rule["id"], f"{rule['familyId']}@{rule['rule']['revision']}", "immutable version id")
    return {
        "revision": rule["rule"]["revision"],
        "ruleHash": rule["ruleHash"],
        "recordHash": rule["recordHash"],
    }


def indicators(ledger, initial):
    equities = [initial, *(units(c["account"]["equity"]) for c in ledger["closes"])]
    peak = initial
    drop, denominator = 0, 1
    for equity in equities:
        peak = max(peak, equity)
        if (peak - equity) * denominator > drop * peak:
            drop, denominator = peak - equity, peak
    trades = []
    basis = held = realized = episode = 0
    entry = None
    for fill in ledger["fills"]:
        n, fee, q = (units(fill[k]) for k in ("notional", "fee", "quantity"))
        if fill["side"] == "buy":
            if not held:
                entry, episode = fill["candleIndex"], 0
            basis += n + fee
            held += q
        else:
            if not 0 < q <= held:
                raise ValueError("sale outside held position")
            allocated = basis if held == q else basis * q // held
            pnl = n - fee - allocated
            basis -= allocated
            held -= q
            realized += pnl
            episode += pnl
            if not held:
                trades.append(
                    dict(entryCandleIndex=entry, exitCandleIndex=fill["candleIndex"], netPnl=fmt(episode))
                )
    profits = sum(max(units(t["netPnl"]), 0) for t in trades)
    losses = sum(max(-units(t["netPnl"]), 0) for t in trades)
    return {
        "metrics": dict(
            totalReturn=ratio(equities[-1] - initial, initial) if initial else None,
            maxDrawdown=ratio(drop, denominator) if peak else None,
            profitFactor=ratio(profits, losses) if losses else None,
            completedTrades=len(trades),
            netPnl=fmt(equities[-1] - initial),
            finalEquity=fmt(equities[-1]),
        ),
        "trades": trades,
        "cost": basis,
        "realized": realized,
        "fees": fmt(sum(units(f["fee"]) for f in ledger["fills"])),
        "equities": equities,
    }


def check_statistics(stats, ledger, values, dataset, config):
    initial = units(config["initialCash"])
    interval = dataset["parsing"]["intervalMs"]
    bars = dataset["candles"]
    first = bars[0]["timestampUtcMs"]
    passive = quote(True, units(number(bars[0]["open"])), initial, config)
    invalid = isinstance(passive, str)
    if invalid:
        passive_cash, passive_qty, fee = initial, 0, 0
    else:
        _, passive_qty, notional, fee = passive
        passive_cash = initial - notional - fee
    benchmark_reason = "基准买入被拒绝：" + passive if invalid else None

    def metric(value, reason=None):
        return {"value": value, "reason": reason}

    peak, peak_time = initial, first
    worst, worst_peak, longest, ongoing, exposed = 0, 1, 0, 0, 0
    covered = {
        f["candleIndex"]
        for f in ledger["fills"]
        if f["side"] == "buy" or f.get("trigger", {}).get("phase") == "intrabar"
    }
    timeline = [
        dict(
            timestampUtcMs=first,
            equity=fmt(initial),
            drawdown=metric("0") if initial else metric(None, "峰值权益为0"),
            benchmarkEquity=None if invalid else fmt(initial),
        )
    ]
    for i, (row, equity) in enumerate(zip(ledger["closes"], values["equities"][1:], strict=True)):
        when = row["timestampUtcMs"]
        if equity >= peak:
            if ongoing:
                longest = max(longest, when - peak_time)
            peak, peak_time, ongoing = equity, when, 0
        else:
            ongoing = when - peak_time
            longest = max(longest, ongoing)
        drop = peak - equity
        if drop * worst_peak > worst * peak:
            worst, worst_peak = drop, peak
        if i in covered or units(row["account"]["position"]["quantity"]) > 0:
            exposed += interval
        passive_equity = passive_cash + passive_qty * units(row["account"]["markPrice"]) // U
        timeline.append(
            dict(
                timestampUtcMs=when,
                equity=fmt(equity),
                drawdown=metric(ratio(drop, peak)) if peak else metric(None, "峰值权益为0"),
                benchmarkEquity=None if invalid else fmt(passive_equity),
            )
        )
    equal(stats["curve"], timeline, "all equity, benchmark and drawdown points")
    duration = bars[-1]["timestampUtcMs"] + interval - first
    trades = values["trades"]
    wins = sum(units(t["netPnl"]) > 0 for t in trades)
    annual = metric(None, "需要至少365天且252根有效收盘样本")
    year = 365 * 86400000
    if duration >= year and len(bars) >= 252:
        last = values["equities"][-1]
        if not initial or last <= 0:
            annual = metric(None, "年化需要初始和末权益均大于0")
        else:
            try:
                rate = expm1(log(float(last) / float(initial)) * year / duration)
            except OverflowError:
                rate = float("inf")
            annual = (
                metric(format(rate, ".12f"))
                if isfinite(rate) and abs(rate) < 1e21
                else metric(None, "年化超出可可靠表示范围")
            )
    checked_subset(
        stats,
        dict(
            realizedPnl=fmt(values["realized"]),
            remainingCostBasis=fmt(values["cost"]),
            unrealizedPnl=fmt(units(ledger["final"]["marketValue"]) - values["cost"]),
            winRate=metric(ratio(wins, len(trades))) if trades else metric(None, "没有已完成交易"),
            maxDrawdownAmount=fmt(worst),
            maxDrawdownDurationMs=longest,
            ongoingDrawdownMs=ongoing,
            exposedMs=exposed,
            exposureFraction=ratio(exposed, duration),
            annualizedReturn=annual,
        ),
        "cost basis, realized/unrealized PnL, drawdown durations, exposure and annualization",
    )

    def passive_metric(val):
        return metric(None, benchmark_reason) if invalid else metric(val)

    checked_subset(
        stats["benchmark"],
        {
            "return": passive_metric(ratio(passive_equity - initial, initial) if initial else None),
            "netPnl": passive_metric(fmt(passive_equity - initial)),
            "fee": fmt(fee),
            "quantity": fmt(passive_qty),
            "cash": fmt(passive_cash),
            "finalEquity": passive_metric(fmt(passive_equity)),
        },
        "passive benchmark",
    )


def check_experiment_payload(dataset, result, stats, config, strategy, risk, end):
    source = dict(dataset=dataset, strategy=strategy, risk=risk, config=config, completedThroughUtcMs=end)
    decisions, expected = simulate(source)
    identities = run_identity(source, decisions)
    checked_subset(result["manifest"], identities, "backtest manifest and original hashes")
    equal(result["manifest"]["sourceFileSha256"], dataset["file"]["sha256"], "source file identity")
    equal(result["manifest"]["signals"], decisions, "signal tape")
    interval = dataset["parsing"]["intervalMs"]
    equal(
        result["signals"],
        [
            dict(signal=s, generatedUtcMs=dataset["candles"][s["candleIndex"]]["timestampUtcMs"] + interval)
            for s in decisions
        ],
        "decision timestamps",
    )
    checked_subset(result, expected, "all orders, fills, fees, balances and close accounts")
    values = indicators(expected, units(config["initialCash"]))
    equal(stats["completedTrades"], values["trades"], "completed trades")
    equal(stats["fees"], values["fees"], "statistics fees")
    equal(stats["netPnl"], values["metrics"]["netPnl"], "statistics PnL")
    na = {
        "totalReturn": "初始本金为0",
        "maxDrawdown": "没有正峰值权益",
        "profitFactor": "已完成交易没有净亏损，分母为0" if values["trades"] else "没有已完成交易",
    }
    for metric, empty_reason in na.items():
        value = values["metrics"][metric]
        equal(
            stats[metric],
            {"value": value, "reason": empty_reason if value is None else None},
            "statistics " + metric,
        )
    equal(
        [p["equity"] for p in stats["curve"]], list(map(fmt, values["equities"])), "all equity curve points"
    )
    check_statistics(stats, expected, values, dataset, config)
    return expected, values


def experiment(d):
    payload = d["payload"]
    equal(d["payloadHash"], historical_hash(payload), "experiment payloadHash")
    m = payload["result"]["manifest"]
    ledger, v = check_experiment_payload(
        payload["dataset"],
        payload["result"],
        payload["statistics"],
        m["config"],
        m["strategy"]["config"],
        m["risk"],
        m["completedThroughUtcMs"],
    )
    return dict(
        runHash=m["runHash"],
        payloadHash=d["payloadHash"],
        fills=len(ledger["fills"]),
        equityPoints=len(v["equities"]),
        fees=v["fees"],
    )


def replay(d, db):
    p = d["payload"]
    equal(d["payloadHash"], historical_hash(p), "replay payloadHash")
    dataset = original(db, "dataset", p["datasetId"])
    if not dataset:
        raise ValueError("missing physical replay dataset " + p["datasetId"])
    equal(historical_hash(dataset), p["sourceHash"], "replay dataset identity")
    equal(dataset["file"]["sha256"], p["sourceFileSha256"], "replay source file")
    equal(dataset["symbol"], p["symbol"], "replay symbol")
    if not 1 <= p["cursor"] <= min(50000, len(dataset["candles"])):
        raise ValueError("replay-v1 requires at least one revealed bar and a cursor inside its source")
    ledger, pending = run_ledger(
        dataset["candles"][: p["cursor"]],
        p["config"],
        dataset["parsing"]["intervalMs"],
        p["decisions"],
        risk=p["risk"],
        interactive=True,
    )
    equal(len(ledger["closes"]), p["cursor"], "replay cursor")
    equal(p["resultHash"], historical_hash(ledger), "replay resultHash")
    state = select(p, ("version", "sourceHash", "config", "risk", "cursor", "decisions", "notes"))
    equal(
        p["stateHash"],
        historical_hash(dict(state, account=ledger["final"], pending=pending)),
        "replay stateHash",
    )
    return dict(
        datasetId=p["datasetId"],
        cursor=p["cursor"],
        decisions=len(p["decisions"]),
        resultHash=p["resultHash"],
        stateHash=p["stateHash"],
    )


def risk(d, db):
    p = d["payload"]
    equal(d["payloadHash"], historical_hash(p), "risk payloadHash")
    source = p["source"]
    e = original(db, "experiment", source["identity"]["id"])
    if e:
        checked_subset(e, source["identity"], "linked original experiment")
    inp = source["input"]
    ds, ledger = simulate(inp)
    hashes = run_identity(inp, ds)
    for k in ("runHash", "dataHash"):
        equal(source[k], hashes[k], "risk source " + k)
    equities = [inp["config"]["initialCash"], *(c["account"]["equity"] for c in ledger["closes"])]
    observed = p["simulation"]
    config = observed["settings"]
    steps = config["steps"]
    n = min(steps + 1, 101)
    points = [i * steps // (n - 1) for i in range(n)]
    expected = risk_reference.sample(config, equities, trace_steps=points)
    for field in ("paths", "quantiles", "meanFinalEquity", "traces"):
        equal(observed[field], expected[field], "Monte Carlo " + field)
    equal(observed["bands"], [expected["bands"][s] for s in points], "Monte Carlo bands")
    equal(
        observed["thresholdEquity"], fmt(units(equities[0]) * config["thresholdPct"] // 100), "risk threshold"
    )
    eq = [units(v["finalEquity"]) for v in expected["paths"]]
    low, high = min(eq), max(eq)
    span = high - low
    count = max(1, min(10, span))
    histogram = [
        dict(lower=fmt(low + up(span * i, count)), upper=fmt(low + up(span * (i + 1), count)), count=0)
        for i in range(count)
    ]
    for x in eq:
        histogram[min(count - 1, (x - low) * count // span) if span else 0]["count"] += 1
    equal(observed["histogram"], histogram, "risk histogram")
    for name, c in [
        ("loss", expected["lossCount"]),
        ("thresholdHits", expected["thresholdHitCount"]),
        ("zeros", eq.count(0)),
    ]:
        equal(observed[name], dict(count=c, total=len(eq), fraction=ratio(c, len(eq))), "risk " + name)
    return dict(
        sourceExperiment=source["identity"]["id"],
        sourceResolution="physical+embedded" if e else "embedded",
        paths=config["paths"],
        steps=steps,
        runHash=source["runHash"],
    )


def aligned(dataset, inp):
    return {
        **dataset,
        "candles": [
            c for c in dataset["candles"] if inp["startUtcMs"] <= c["timestampUtcMs"] <= inp["endUtcMs"]
        ],
    }


def portfolio_hashes(d):
    equal(d["payloadHash"], historical_hash(select(d, ("input", "result"))), "portfolio payloadHash")
    equal(
        d["recordHash"], historical_hash(without(d, "input", "result", "recordHash")), "portfolio recordHash"
    )


def subaccount_inputs(inp):
    capital = units(inp["initialCash"])
    assets = inp["assets"]
    numerators = [capital * units(asset["weightPercent"]) for asset in assets]
    den = 100 * U
    amounts = [n // den for n in numerators]
    order = sorted(range(len(assets)), key=lambda i: (-(numerators[i] % den), assets[i]["dataset"]["symbol"]))
    for i in order[: capital - sum(amounts)]:
        amounts[i] += 1
    for asset, amount in zip(assets, amounts, strict=True):
        yield dict(
            dataset=aligned(asset["dataset"], inp),
            config=dict(asset["costs"], initialCash=fmt(amount)),
            strategy=asset["strategy"],
            risk=asset["risk"],
            completedThroughUtcMs=inp["completedThroughUtcMs"],
        )


def portfolio(d):
    portfolio_hashes(d)
    inp, out = d["input"], d["result"]
    assets, capital = inp["assets"], units(inp["initialCash"])
    expected_ledgers = []
    for subaccount, child in zip(subaccount_inputs(inp), out["assets"], strict=True):
        dataset, cfg = subaccount["dataset"], subaccount["config"]
        equal(child["symbol"], dataset["symbol"], "asset input symbol")
        equal(child["initialCash"], cfg["initialCash"], "independent subaccount allocation")
        ledger, _ = check_experiment_payload(
            dataset,
            child["result"],
            child["statistics"],
            cfg,
            subaccount["strategy"],
            subaccount["risk"],
            inp["completedThroughUtcMs"],
        )
        expected_ledgers.append(ledger)
    curve = out["curve"]
    equal(curve[0]["equity"], fmt(capital), "portfolio opening equity")
    for j, block in enumerate(zip(*(s["closes"] for s in expected_ledgers), strict=True), start=1):
        expected = {
            k: fmt(sum(units(c["account"][k]) for c in block)) for k in ("cash", "marketValue", "equity")
        }
        checked_subset(curve[j], expected, f"portfolio point {j}")
    equal(len(curve), len(expected_ledgers[0]["closes"]) + 1, "portfolio timeline")
    fill_count = sum(len(s["fills"]) for s in expected_ledgers)
    equal(out["fillCount"], fill_count, "portfolio fill count")
    equal(
        out["fees"], fmt(sum(units(f["fee"]) for s in expected_ledgers for f in s["fills"])), "portfolio fees"
    )
    return dict(
        embeddedSources=[a["dataset"]["id"] for a in assets],
        subaccounts=len(assets),
        fills=fill_count,
        equityPoints=len(curve),
        recordHash=d["recordHash"],
    )


def shared_tape(inp):
    from reference_ledger import signals
    import re

    assets, signal_tapes, strategy_versions = [], {}, {}
    quote_currency = inp["quoteCurrency"].strip().upper()
    every = inp.get("rebalanceEvery", 0)
    if inp["mode"] not in ("rebalance", "shared-strategy") or (inp["mode"] == "rebalance") != (every > 0):
        raise ValueError("invalid shared-pool execution schedule")
    clock = None
    for asset in inp["assets"]:
        data = aligned(asset["dataset"], inp)
        raw_symbol = data["symbol"].strip().upper()
        match = re.fullmatch(r"([A-Z0-9]{1,32})[/-]([A-Z0-9]{1,32})", raw_symbol)
        if match:
            base, quote_name = match.groups()
            equal(quote_name, quote_currency, "embedded asset quote")
        else:
            if not raw_symbol.endswith(quote_currency):
                raise ValueError(f"invalid compact shared-pool symbol {raw_symbol}")
            base = raw_symbol[: -len(quote_currency)]
        if not re.fullmatch(r"[A-Z0-9]{1,32}", base) or base == quote_currency:
            raise ValueError("invalid shared-pool asset base")
        symbol = base + "/" + quote_currency
        interval = data["parsing"]["intervalMs"]
        closes = [bar["timestampUtcMs"] + interval for bar in data["candles"]]
        if not closes:
            raise ValueError("empty shared-pool common clock")
        if clock is not None:
            equal(closes, clock, "shared-pool common clock")
        clock = closes
        if not every:
            strategy = asset["strategy"]
            is_rules = strategy["kind"] == "rules"
            if is_rules:
                check_rule(asset["ruleRecord"])
                equal(strategy["rule"], asset["ruleRecord"]["rule"], "embedded shared-pool rule")
            signal_tapes[symbol] = signals(data["candles"], strategy)
            strategy_versions[symbol] = (
                "causal-declarative-rules-v1" if is_rules else "causal-close-ma-rsi-breakout-v1"
            )
        else:
            strategy_versions[symbol] = None
        assets.append(
            dict(
                symbol=symbol,
                bars=[[number(c[k]) for k in ("open", "high", "low", "close")] for c in data["candles"]],
                costs=asset["costs"],
                weightPercent=asset["weightPercent"],
                risk=asset.get("risk", {}),
            )
        )
    expected = shared_pool_reference.simulate(
        dict(assets=assets, initialCash=inp["initialCash"], rebalanceEvery=every), signal_tapes=signal_tapes
    )
    decisions = []
    for i, close in enumerate(clock):
        if every:
            if (i + 1) % every == 0:
                decisions.append(
                    dict(
                        barIndex=i,
                        closeUtcMs=close,
                        symbol=None,
                        action="rebalance",
                        reason="period-complete",
                    )
                )
        else:
            for symbol in sorted(signal_tapes):
                signal = signal_tapes[symbol][i]
                decisions.append(
                    dict(
                        barIndex=i,
                        closeUtcMs=close,
                        symbol=symbol,
                        action=signal["action"],
                        reason=signal["reason"],
                    )
                )
    expected["decisions"] = decisions
    for row in expected["assets"]:
        row["strategyVersion"] = strategy_versions[row["symbol"]]
    return expected


def shared(d):
    portfolio_hashes(d)
    inp, out = d["input"], d["result"]
    expected = shared_tape(inp)
    equal(out["decisions"], expected["decisions"], "shared close decision tape")
    equal(out["allocations"], expected["allocations"], "shared cash allocation ledger")
    equal(out["benchmarkReasons"], expected["benchmarkReasons"], "shared buy-and-hold rejections")
    fills = [o for o in out["orders"] if o["status"] == "filled"]
    compare_rows(fills, expected["fills"], "shared execution and ledger")
    compare_rows(
        [o for o in out["orders"] if o["status"] == "rejected"], expected["rejects"], "shared rejects"
    )
    compare_rows(
        [o for o in out["orders"] if o["phase"] == "buy" and units(o["requestedBudget"] or "0") > 0],
        expected["grants"],
        "requested and approved budgets",
    )
    compare_rows(out["assets"], expected["assets"], "shared per-asset balances")
    compare_rows(out["rebalances"], expected["rebalances"], "shared rebalance weights")
    equal(len(out["curve"]), len(expected["curve"]), "shared timeline")
    for point, exp in zip(out["curve"], expected["curve"]):
        checked_subset(point, without(exp, "weights"), "shared ledger point")
        equal(point["weightsPercent"] + [point["cashWeightPercent"]], exp["weights"], "shared weights")
    checked_subset(
        out, select(expected, ("fees", "netPnl", "maxDrawdown", "benchmarkReturn")), "shared final statistics"
    )
    return dict(
        embeddedSources=[a["dataset"]["id"] for a in inp["assets"]],
        fills=len(fills),
        equityPoints=len(out["curve"]),
        allocations=len(out["allocations"]),
        recordHash=d["recordHash"],
    )


def regime_fills(dataset, ledger):
    # A protective sale after the open still exposed this bar even when it
    # leaves the final quantity at zero. Opening-gap liquidation is distinct.
    return [
        dict(
            f,
            symbol=dataset["symbol"],
            barIndex=f["candleIndex"],
            phase="protection-after-buys" if (f.get("trigger") or {}).get("phase") == "intrabar" else "open",
        )
        for f in ledger["fills"]
    ]


def classify_reference(datasets, reference, initial, fills, params):
    by_symbol = {d["symbol"]: d for d in datasets}
    if len(by_symbol) != len(datasets) or reference not in by_symbol:
        raise ValueError(f"missing or ambiguous market reference symbol {reference!r}")
    selected = by_symbol[reference]
    candles = selected["candles"]
    if not candles:
        raise ValueError("empty market regime history")
    stamps = [c["timestampUtcMs"] for c in candles]
    interval = selected["parsing"]["intervalMs"]
    if interval <= 0 or any(b - a != interval for a, b in zip(stamps, stamps[1:])):
        raise ValueError("discontinuous reference asset series")
    for dataset in datasets:
        equal(dataset["parsing"]["intervalMs"], interval, "regime asset interval")
        equal(
            [c["timestampUtcMs"] for c in dataset["candles"]], stamps, "regime aligned historical timestamps"
        )
    marks = [
        {symbol: Decimal(str(dataset["candles"][i]["close"])) for symbol, dataset in by_symbol.items()}
        for i in range(len(stamps))
    ]
    opens = [Decimal(str(c["open"])) for c in candles]
    closes = [mark[reference] for mark in marks]
    capital = Decimal(initial)
    entries = regime_reference.ledger(capital, marks, fills, stamps[0], interval)
    return regime_reference.analyze(
        opens, closes, capital, entries, params["lookback"], params["thresholdBps"], stamps[0], interval
    )


def market_attribution(dataset, config, ledger, params):
    return classify_reference(
        [dataset], dataset["symbol"], config["initialCash"], regime_fills(dataset, ledger), params
    )


def regime_versions(identity):
    return dict(
        engine=identity["algorithmVersion"],
        conversion=identity["conversionVersion"],
        statistics="statistics-v1",
        strategy=identity["strategy"]["version"],
        **select(identity, ("dataHash", "signalHash", "runHash")),
    )


def regime(d, db):
    equal(d["reportHash"], historical_hash(without(d, "reportHash")), "regime reportHash")
    source, ref = d["source"], d["reference"]
    kind, inp = source["kind"], source["input"]
    kinds = {"single": ("experiment", 1), "portfolio": ("portfolio", 1), "shared": ("shared_pool", 2)}
    if kind not in kinds:
        raise ValueError(f"unknown market regime source kind {kind!r}")
    table_kind, schema = kinds[kind]
    equal(source["schemaVersion"], schema, "regime source schema")
    linked = original(db, table_kind, source["id"])
    if linked:
        checked_subset(
            linked,
            select(source, ("id", "name", "createdUtcMs", "schemaVersion", "payloadHash")),
            "linked original regime source",
        )
    if kind == "single":
        equal(ref, None, "single regime reference selection")
        decisions, ledger = simulate(inp)
        identity = run_identity(inp, decisions)
        checked_subset(source, select(identity, ("dataHash", "runHash")), "regime original identifiers")
        equal(source["versions"], regime_versions(identity), "single regime original versions")
        result = market_attribution(inp["dataset"], inp["config"], ledger, d["params"])
    else:
        fmt_name = (
            "riverlab-portfolio-experiment" if kind == "portfolio" else "riverlab-shared-pool-experiment"
        )
        header = dict(
            format=fmt_name, **select(source, ("id", "name", "createdUtcMs", "schemaVersion", "payloadHash"))
        )
        equal(source["recordHash"], historical_hash(header), "regime source recordHash")
        if linked:
            equal(linked["recordHash"], source["recordHash"], "regime source physical recordHash")
            equal(linked["input"], inp, "regime original embedded portfolio input")
        datasets = [aligned(asset["dataset"], inp) for asset in inp["assets"]]
        if kind == "portfolio":
            fills, versions = [], []
            for account in subaccount_inputs(inp):
                decisions, ledger = simulate(account)
                fills.extend(regime_fills(account["dataset"], ledger))
                versions.append(
                    dict(
                        symbol=account["dataset"]["symbol"],
                        versions=regime_versions(run_identity(account, decisions)),
                    )
                )
            expected_versions = dict(algorithm="independent-spot-portfolio-v1", assets=versions)
        else:
            modes = {"rebalance": "shared-spot-rebalance-v1", "shared-strategy": "shared-spot-strategy-v1"}
            if inp["mode"] not in modes:
                raise ValueError("unknown shared portfolio regime mode")
            fills = shared_tape(inp)["fills"]
            versions = []
            for asset in inp["assets"]:
                strategy = asset.get("strategy")
                version = (
                    (
                        "causal-declarative-rules-v1"
                        if strategy["kind"] == "rules"
                        else "causal-close-ma-rsi-breakout-v1"
                    )
                    if strategy
                    else None
                )
                versions.append(dict(symbol=asset["dataset"]["symbol"], strategy=version))
            expected_versions = dict(
                algorithm=modes[inp["mode"]],
                assets=versions,
                execution="shared-spot-clock-v1",
                conversion="number-shortest-decimal-fixed18-v1",
            )
        equal(source["versions"], expected_versions, "regime historical engine versions")
        result = classify_reference(datasets, ref, inp["initialCash"], fills, d["params"])
    equal(d["result"], result, "all market labels, runs, distributions and attribution")
    return dict(
        sourceKind=kind,
        sourceExperiment=source["id"],
        reference=ref,
        sourceResolution="physical+embedded" if linked else "embedded",
        labels=len(result["labels"]),
        switches=result["switches"],
        reportHash=d["reportHash"],
    )


def advanced_plan(inp):
    dimensions = []
    for ax in inp["axes"]:
        lo, hi, step = (Decimal(str(ax[k])) for k in ("min", "max", "step"))
        if step <= 0 or hi < lo or (hi - lo) // step > 1024:
            raise ValueError("invalid independent grid dimension")
        dimensions.append([lo + v * step for v in range(int((hi - lo) // step) + 1)])
    candidates, invalid = [], []
    for cid, values in enumerate(product(*dimensions)):
        rule = deepcopy(inp["ruleRecord"]["rule"])
        plain = [int(v) if v == int(v) else float(v) for v in values]
        for ax, value in zip(inp["axes"], plain):
            rule[ax["side"]]["conditions"][ax["condition"]][ax["field"]] = value
        if any(
            c["kind"] == "cross" and c["fastPeriod"] >= c["slowPeriod"]
            for side in ("buy", "sell")
            for c in rule[side]["conditions"]
        ):
            invalid.append(dict(values=plain, reason="规则无效：交叉周期必须为1–50,000整数，快线小于慢线。"))
            continue
        warmups = []
        for group in (rule["buy"], rule["sell"]):
            if not group["enabled"]:
                continue
            for c in (c for c in group["conditions"] if c["enabled"]):
                if c["kind"] == "cross":
                    warmups.append(c["slowPeriod"] + 1)
                elif c["kind"] == "breakout":
                    warmups.append(c["lookback"] + 1)
                else:
                    warmups.append(c["period"] + (c["kind"] == "rsi"))
        candidates.append(dict(id=cid, values=plain, rule=rule, warmupBars=max(warmups)))
    combinations = len(candidates) + len(invalid)
    search = inp["search"]
    if search["kind"] == "random":
        draw = risk_reference.pcg(search["seed"])
        for i in range(search["count"]):
            n = len(candidates) - i
            w = draw()
            while w < (1 << 32) % n:
                w = draw()
            j = i + w % n
            candidates[i], candidates[j] = candidates[j], candidates[i]
        candidates = sorted(candidates[: search["count"]], key=lambda c: c["id"])
    size = len(inp["dataset"]["candles"])
    evaluation = inp["evaluation"]
    train = evaluation["trainBars"]
    step = evaluation.get("testBars", size - train)
    if train <= 0 or step <= 0:
        raise ValueError("invalid train/test bounds")
    windows = []
    for i, start in enumerate(range(0, size - train - step + 1, step)):
        windows += [
            dict(fold=i, role="train", start=start, end=start + train),
            dict(fold=i, role="test", start=start + train, end=start + train + step),
        ]
    return dict(
        candidates=candidates,
        invalid=invalid,
        combinations=combinations,
        windows=windows,
        trailingBars=size - windows[-1]["end"],
        runs=len(windows) // 2 * (len(candidates) + 1),
        bars=sum((w["end"] - w["start"]) * (len(candidates) if w["role"] == "train" else 1) for w in windows),
    )


def advanced(d, db):
    equal(d["reportHash"], historical_hash(without(d, "reportHash")), "advanced reportHash")
    inp = d["input"]
    rule = inp["ruleRecord"]
    rule_ids = check_rule(rule)
    linked = original(db, "rule", rule["id"])
    if linked:
        equal(linked, rule, "linked full version content")
    plan = advanced_plan(inp)
    equal(d["result"]["plan"], plan, "full parameter grid and evaluation windows")
    folds = d["result"]["folds"]
    equal(len(folds), len(plan["windows"]) // 2, "fold count")

    def evaluate(candidate, window, row):
        ds = inp["dataset"]
        bars = ds["candles"][window["start"] : window["end"]]
        end = bars[-1]["timestampUtcMs"] + ds["parsing"]["intervalMs"]
        window_input = dict(
            dataset=dict(ds, candles=bars),
            strategy={"kind": "rules", "rule": candidate["rule"]},
            config=inp["config"],
            risk=inp["risk"],
            completedThroughUtcMs=end,
        )
        decisions, ledger = simulate(window_input)
        metrics = indicators(ledger, units(inp["config"]["initialCash"]))["metrics"]
        estimates = dict(
            candidateId=candidate["id"],
            window=window,
            startUtcMs=bars[0]["timestampUtcMs"],
            endUtcMs=end,
            metrics=metrics,
            runHash=run_identity(window_input, decisions)["runHash"],
            regimes=market_attribution(window_input["dataset"], inp["config"], ledger, inp["regime"])[
                "summaries"
            ],
        )
        checked_subset(row, estimates, "candidate evidence " + str(candidate["id"]) + " " + window["role"])
        filters = inp["filters"]
        passes = metrics["completedTrades"] >= filters["minTrades"]
        for field, metric in [
            ("minReturn", "totalReturn"),
            ("maxDrawdown", "maxDrawdown"),
            ("minProfitFactor", "profitFactor"),
        ]:
            if filters[field] is not None:
                value = metrics[metric]
                passes &= value is not None and (
                    Decimal(value) <= Decimal(str(filters[field]))
                    if field == "maxDrawdown"
                    else Decimal(value) >= Decimal(str(filters[field]))
                )
        reasons = []
        if window["role"] == "train":
            for label, field, metric in [
                ("收益率", "minReturn", "totalReturn"),
                ("最大回撤", "maxDrawdown", "maxDrawdown"),
                ("利润因子", "minProfitFactor", "profitFactor"),
            ]:
                limit = filters[field]
                if limit is not None:
                    value = metrics[metric]
                    if value is None:
                        reasons.append(label + "为 NA，未通过筛选。")
                    elif (
                        (Decimal(value) > Decimal(str(limit)))
                        if field == "maxDrawdown"
                        else (Decimal(value) < Decimal(str(limit)))
                    ):
                        reasons.append(label + "未满足训练筛选阈值 " + str(limit) + "。")
            if metrics["completedTrades"] < filters["minTrades"]:
                reasons.append("完成交易次数少于 " + str(filters["minTrades"]) + "。")
        equal(row["reasons"], reasons, "filter rejection reasons")
        return [
            not passes,
            *(
                (metrics[k] is None, (1 if k == "maxDrawdown" else -1) * Decimal(str(metrics[k] or 0)))
                for k in inp["sort"]
            ),
            candidate["id"],
        ]

    for fold_no, fold in enumerate(folds):
        trainwin, testwin = plan["windows"][fold_no * 2 : fold_no * 2 + 2]
        observed = {r["candidateId"]: r for r in fold["train"]}
        ranks = sorted(evaluate(c, trainwin, observed[c["id"]]) for c in plan["candidates"])
        equal([r["candidateId"] for r in fold["train"]], [r[-1] for r in ranks], "training ranks")
        selected = next((r[-1] for r in ranks if not r[0]), None)
        equal(fold["selectedId"], selected, "training-only selection")
        if selected is None:
            equal(fold["test"], None, "test without qualified candidate")
        else:
            evaluate(next(c for c in plan["candidates"] if c["id"] == selected), testwin, fold["test"])
    return dict(
        ruleId=rule["id"],
        ruleHash=rule_ids["ruleHash"],
        candidates=len(plan["candidates"]),
        folds=len(folds),
        outOfSampleRuns=sum(f["test"] is not None for f in folds),
        reportHash=d["reportHash"],
    )


def source_links(kind, row, db):
    links = []

    def dataset(source):
        expected = historical_hash(source)
        linked = original(db, "dataset", source["id"])
        if linked is not None:
            equal(
                historical_hash(linked), expected, "embedded dataset disagrees with original " + source["id"]
            )
        links.append(
            dict(
                kind="dataset",
                id=source["id"],
                sourceHash=expected,
                relation="physical+embedded" if linked is not None else "embedded",
            )
        )

    def strategy(config, record=None):
        if config is None or config["kind"] != "rules":
            return
        digest = historical_hash(config["rule"])
        entry = dict(kind="rule", revision=config["rule"]["revision"], ruleHash=digest, relation="embedded")
        if record is not None:
            check_rule(record)
            equal(record["ruleHash"], digest, "embedded full rule")
            linked = original(db, "rule", record["id"])
            if linked is not None:
                equal(linked, record, "original rule version")
                entry["relation"] = "physical+embedded"
            entry["id"] = record["id"]
        links.append(entry)

    def inputs(src):
        if "assets" in src:
            for asset in src["assets"]:
                dataset(asset["dataset"])
                strategy(asset.get("strategy"), asset.get("ruleRecord"))
        else:
            dataset(src["dataset"])
            strategy(src.get("strategy"))

    if kind == "experiment":
        payload = row["payload"]
        inputs(dict(dataset=payload["dataset"], strategy=payload["result"]["manifest"]["strategy"]["config"]))
    elif kind == "advanced":
        inputs(row["input"])
        record = row["input"]["ruleRecord"]
        strategy(dict(kind="rules", rule=record["rule"]), record)
    elif kind in ("portfolio", "shared_pool"):
        inputs(row["input"])
    elif kind == "regime":
        inputs(row["source"]["input"])
    elif kind == "risk":
        inputs(row["payload"]["source"]["input"])
    return links


def check_history(kind, value, db):
    with localcontext() as ctx:
        ctx.prec = 250
        if kind == "dataset":
            result = check_dataset(value)
        elif kind == "rule":
            result = check_rule(value)
        elif kind == "experiment":
            result = experiment(value)
        elif kind == "portfolio":
            result = portfolio(value)
        elif kind == "shared_pool":
            result = shared(value)
        elif kind == "replay":
            result = replay(value, db)
        elif kind == "risk":
            result = risk(value, db)
        elif kind == "regime":
            result = regime(value, db)
        elif kind == "advanced":
            result = advanced(value, db)
        else:
            raise ValueError("unsupported domain " + kind)
        result["inputLinks"] = source_links(kind, value, db)
        return result
