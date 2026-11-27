"""Independent Decimal oracle for historical labels and attribution.

No TS output is read. The single-asset tape uses the independent spot accounting
reference. The portfolio tape uses the independent shared-pool integer reference
for its orders, then rebuilds per-symbol cost basis and period P&L here.
"""
import argparse
import json
import sys
from collections import defaultdict
from decimal import Decimal as D, ROUND_DOWN, localcontext
from itertools import groupby
from pathlib import Path
from statistics import median

sys.dont_write_bytecode = True

import portfolio_reference
import shared_pool_reference

START = 1735689600000
MINUTE = 60000
ATOM = D('1e-18')
RATIO = D('1e-12')
STATES = ['BULL', 'BEAR', 'SIDEWAYS', 'UNKNOWN']
FIXTURE = Path(__file__).resolve().parents[1] / 'fixtures' / 'market-regime-reference.json'


def text(value):
    return format(D(value).normalize(), 'f') if value else '0'


def ratio(value):
    return value.quantize(RATIO, rounding=ROUND_DOWN)


def distribution(values):
    if not values:
        return dict(count=0, min=None, median=None, max=None, mean=None, volatility=None)
    avg = sum(values) / len(values)
    variance = sum((v - avg) ** 2 for v in values) / len(values)
    return dict(count=len(values), min=text(min(values)), max=text(max(values)),
                median=text(ratio(median(values))), mean=text(ratio(avg)),
                volatility=text(ratio(variance.sqrt())) if len(values) >= 2 else None)


def labels(closes, stamps, n, bps, interval=MINUTE):
    if any(y - x != interval for x, y in zip(stamps, stamps[1:])):
        raise ValueError('discontinuous UTC axis')
    # Compare to the exact two price levels. Rounding a ratio before this
    # comparison would lose a strict crossing smaller than one return tick.
    result = []
    for i, price in enumerate(closes):
        if i < n:
            result.append('UNKNOWN')
        else:
            base = closes[i-n]
            limit = D(bps) / 10000
            result.append('BULL' if price > base * (1 + limit) else
                          'BEAR' if price < base * (1 - limit) else 'SIDEWAYS')
    return result


def analyze(opens, closes, initial, bars, lookback, threshold, start_time=START, interval=MINUTE):
    stamps = [start_time + i * interval for i in range(len(closes))]
    if [bar['closeUtcMs'] for bar in bars] != [stamp + interval for stamp in stamps]:
        raise ValueError('ledger close timestamps differ from the reference asset')
    at_close = labels(closes, stamps, lookback, threshold, interval)
    effective = ['UNKNOWN', *at_close[:-1]]
    equity = [initial, *(D(b['equity']) for b in bars)]
    pnl = [y - x for x, y in zip(equity, equity[1:])]
    assert all(p == D(b['realizedDelta']) + D(b['unrealizedDelta']) for p, b in zip(pnl, bars))
    asset = [opens[0], *closes]
    runs = []
    for state, grouped in groupby(enumerate(effective), key=lambda item: item[1]):
        indices = [i for i, _ in grouped]
        start, stop = indices[0], indices[-1] + 1
        change = equity[stop] - equity[start]
        runs.append(dict(state=state, startUtcMs=stamps[start], endUtcMs=start_time + stop * interval,
                         bars=len(indices), startEquity=text(equity[start]), endEquity=text(equity[stop]),
                         netPnl=text(change), returnFraction=text(ratio(change/equity[start])) if equity[start] else None))

    summaries = []
    for state in STATES:
        ix = [i for i, tag in enumerate(effective) if tag == state]
        held = sum(bars[i]['exposed'] for i in ix)
        rows = [bars[i] for i in ix]
        def total(field):
            return text(sum(D(b[field]) for b in rows))
        summaries.append(dict(state=state, bars=len(ix), durationMs=len(ix)*interval,
                              timeFraction=text(ratio(D(len(ix)) / len(bars))),
                              occurrences=sum(r['state'] == state for r in runs),
                              netPnl=text(sum(pnl[i] for i in ix)), realizedDelta=total('realizedDelta'),
                              unrealizedDelta=total('unrealizedDelta'), fills=sum(b['fills'] for b in rows),
                              fees=total('fees'), exposedMs=held*interval,
                              exposureFraction=text(ratio(D(held) / len(ix))) if ix else None,
                              periodReturns=distribution([ratio(pnl[i]/equity[i]) for i in ix if equity[i]]),
                              assetReturns=distribution([ratio((asset[i+1]-asset[i])/asset[i]) for i in ix])))
    assert sum(D(s['netPnl']) for s in summaries) == equity[-1] - initial
    return dict(labels=at_close, runs=runs, summaries=summaries, switches=len(runs)-1,
                netPnl=text(equity[-1] - initial))


def ledger(initial, marks, fills, start_time=START, interval=MINUTE):
    """Book net sale proceeds against pro rata remaining 18-place cost."""
    quantities, costs = {}, {}
    cash = initial
    prev_floating = D(0)
    rows = []
    events_by_bar = defaultdict(list)
    for fill in fills:
        index = fill['barIndex']
        if type(index) is not int or not 0 <= index < len(marks):
            raise ValueError('fill outside attribution timeline')
        events_by_bar[index].append(fill)
    for i, closing in enumerate(marks):
        events = events_by_bar.get(i, ())
        realized = fees = D(0)
        covered_intrabar = False
        for f in events:
            symbol = f['symbol']
            qty, charge, fee = (D(f[k]) for k in ['quantity', 'notional', 'fee'])
            before, cost = quantities.get(symbol, D(0)), costs.get(symbol, D(0))
            fees += fee
            if f['side'] == 'buy':
                cash -= charge + fee
                quantities[symbol], costs[symbol] = before + qty, cost + charge + fee
                covered_intrabar = True
            else:
                allocated = cost if qty == before else (cost * qty / before).quantize(ATOM, rounding=ROUND_DOWN)
                cash += charge - fee
                realized += charge - fee - allocated
                quantities[symbol], costs[symbol] = before - qty, cost - allocated
                covered_intrabar |= f['phase'] == 'protection-after-buys'
        value = sum((q * closing[s]).quantize(ATOM, rounding=ROUND_DOWN) for s, q in quantities.items())
        floating = value - sum(costs.values())
        rows.append(dict(closeUtcMs=start_time+(i+1)*interval, equity=text(cash + value),
                         realizedDelta=text(realized), unrealizedDelta=text(floating-prev_floating),
                         fills=len(events), fees=text(fees), exposed=covered_intrabar or any(q > 0 for q in quantities.values())))
        prev_floating = floating
    return rows


def single():
    raw = [100, 110, 99, 100, 130, 130, 89, 120, 90, 135, 90, 110]
    prices = list(map(D, raw))
    opens = [D(80), *prices[1:]]
    initial = D('1000.000000000000000003')
    costs = dict(feeBps=25, buySlippageBps=12, sellSlippageBps=19, quantityDecimals=4, minNotional='0')
    cash, quantity = initial, D(0)
    fills = []
    for i in range(2, len(prices)):
        up = prices[i-1] > max(opens[i-2], prices[i-2])
        down = prices[i-1] < min(opens[i-2], prices[i-2])
        if not ((up and not quantity) or (down and quantity)):
            continue
        side = 'buy' if up else 'sell'
        new_cash, new_quantity, fee = portfolio_reference.transaction(side, opens[i], cash, quantity, costs)
        notional = abs(new_cash - cash + fee)
        fills.append(dict(barIndex=i, symbol='TEST', side=side, phase=side, fee=fee, notional=notional,
                          quantity=abs(new_quantity-quantity)))
        cash, quantity = new_cash, new_quantity
    bars = ledger(initial, [{'TEST': p} for p in prices], fills)
    return dict(prices=raw, opens=list(map(int, opens)), costs=costs, initialCash=text(initial), bars=bars,
                params=dict(lookback=1, thresholdBps=1000), result=analyze(opens, prices, initial, bars, 1, 1000))


def shared():
    spec = next(s for s in shared_pool_reference.scenarios() if s['name'] == 'partial-rebalance')
    oracle = shared_pool_reference.simulate(spec)
    n = len(spec['assets'][0]['bars'])
    initial = D(spec['initialCash'])
    marks = [{a['symbol']: D(a['bars'][i][3]) for a in spec['assets']} for i in range(n)]
    bars = ledger(initial, marks, oracle['fills'])
    assert [r['equity'] for r in bars] == [r['equity'] for r in oracle['curve'][1:]]
    results = []
    for asset in spec['assets']:
        prices = [D(b[3]) for b in asset['bars']]
        opens = [D(b[0]) for b in asset['bars']]
        results.append(dict(symbol=asset['symbol'], result=analyze(opens, prices, initial, bars, 2, 500)))
    return dict(scenario=spec['name'], bars=bars, params=dict(lookback=2, thresholdBps=500), references=results)


def classification():
    examples = [
        ('positive and negative equalities', ['100', '110', '99'], 1, 1000),
        ('positive sub-tick crossing', ['100', '110.000000000001'], 1, 1000),
        ('negative sub-tick crossing', ['100', '89.999999999999'], 1, 1000),
        ('history shorter than lookback', ['10', '20', '30'], 3, 1),
        ('frequent transitions', ['10', '11', '9', '11', '9', '11', '9'], 1, 100),
        ('two-bar window', ['100', '110', '101', '125', '90', '128'], 2, 500),
    ]
    return [dict(name=name, closes=values, lookback=n, thresholdBps=bps,
                 expected=labels(list(map(D, values)), [START+i*MINUTE for i in range(len(values))], n, bps))
            for name, values, n, bps in examples]


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    with localcontext() as context:
        context.prec = 120
        fixture = dict(classification=classification(), single=single(), shared=shared())
        gap = [START, START + MINUTE, START + 3 * MINUTE]
        try:
            labels(list(map(D, ['5', '6', '7'])), gap, 1, 100)
        except ValueError:
            fixture['invalidAxis'] = gap
        else:
            raise AssertionError('gap must be rejected')
    if args.check:
        if fixture != json.loads(FIXTURE.read_text(encoding='utf-8')):
            raise SystemExit('Market regime independent Decimal fixture mismatch')
        print('Market regime Decimal oracle matched 6 label paths, a rejected gap, single ledger and 2 explicit portfolio references.')
    else:
        FIXTURE.write_text(json.dumps(fixture, indent=2) + '\n', encoding='utf-8')
