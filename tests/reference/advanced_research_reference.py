"""Independent Phase 5E rolling optimization oracle, using whole units and exact ratios.

The input CSV is synthetic one-minute OHLC. One USDT per price unit, whole lots,
no fees or slippage. Each train/test window begins with 1000 USDT in cash and
fresh price history. No application code, engine outputs or network are used.
"""
import argparse
import csv
import hashlib
import json
from fractions import Fraction
from pathlib import Path

INITIAL = 1000
EPOCH = 1735689600000
MINUTE = 60000
LOOKBACKS = (1, 2, 3)
STATES = ('BULL', 'BEAR', 'SIDEWAYS', 'UNKNOWN')


def ratio(value):
    """Statistics V1 truncates dimensionless ratios toward zero at 12 places."""
    scale = 10**12
    signed = int(Fraction(value) * scale)
    whole, fraction = divmod(abs(signed), scale)
    return (('-' if signed < 0 else '') + f'{whole}.{fraction:012}').rstrip('0').rstrip('.')


def read_prices(directory):
    with (directory / 'phase-5e-rolling-synthetic.csv').open(encoding='utf-8', newline='') as stream:
        rows = list(csv.DictReader(stream))
    assert len(rows) == 48
    for i, bar in enumerate(rows):
        assert int(bar['timestamp']) == EPOCH + i * MINUTE
        assert len({bar[k] for k in ('open', 'high', 'low', 'close')}) == 1
        assert int(bar['close']) > 0 and bar['volume'] == '1'
    return [int(bar['close']) for bar in rows]


def content_hash(obj):
    canonical = json.dumps(obj, sort_keys=True, separators=(',', ':'), ensure_ascii=True)
    return hashlib.sha256(canonical.encode('ascii')).hexdigest()


def check_rule(directory):
    record = json.loads((directory / 'phase-5e-breakout-rule.json').read_text(encoding='utf-8'))
    assert record.pop('recordHash') == content_hash(record)
    rule = record['rule']
    assert record['ruleHash'] == content_hash(rule)
    assert record['format'] == 'riverlab-strategy-rule' and record['schemaVersion'] == 1
    assert rule['revision'] == rule['schemaVersion'] == 1
    for side, lookback, direction in [('buy', 1, 'above'), ('sell', 2, 'below')]:
        assert rule[side] == dict(enabled=True, operator='AND', conditions=[
            dict(kind='breakout', enabled=True, lookback=lookback, direction=direction)])


def signal_tape(prices, buy_period):
    """Compute rule-group edges by scanning each completed prefix independently."""
    tape = []
    previous_buy = previous_sell = False
    for i, price in enumerate(prices):
        if i < max(buy_period, 2):
            tape.append('hold')
            continue
        buy = price > max(prices[i-buy_period:i])
        sell = price < min(prices[i-2:i])
        assert not (buy and sell)
        tape.append('buy' if buy and not previous_buy else
                    'sell' if sell and not previous_sell else 'hold')
        previous_buy, previous_sell = buy, sell
    return tape


def run_window(prices, period):
    equity = [INITIAL]
    completed = []
    qty = entry_cost = 0
    cash = INITIAL
    # The order at each open is decided solely by the preceding close.
    for price, action in zip(prices, ['hold', *signal_tape(prices, period)[:-1]]):
        if action == 'buy' and qty == 0:
            qty, cash = divmod(cash, price)
            entry_cost = qty * price
        elif action == 'sell' and qty:
            proceeds = qty * price
            completed.append(proceeds - entry_cost)
            cash += proceeds
            qty = entry_cost = 0
        equity.append(cash + qty * price)

    peak = INITIAL
    drawdown = Fraction(0)
    for marked in equity:
        peak = max(peak, marked)
        drawdown = max(drawdown, Fraction(peak - marked, peak))
    gains = sum(max(p, 0) for p in completed)
    losses = -sum(min(p, 0) for p in completed)
    net = equity[-1] - INITIAL
    assert net == sum(completed) + qty * prices[-1] - entry_cost
    return dict(totalReturn=ratio(Fraction(net, INITIAL)), maxDrawdown=ratio(drawdown),
                profitFactor=ratio(Fraction(gains, losses)) if losses else None,
                completedTrades=len(completed), netPnl=str(net), finalEquity=str(equity[-1])), equity


def lagged_attribution(prices, equity):
    n, threshold_bps = 2, 500
    sums = {state: dict(bars=0, netPnl=0) for state in STATES}
    for i in range(len(prices)):
        previous = i-1
        state = 'UNKNOWN'
        if previous >= n:
            base = prices[previous-n]
            change = (prices[previous]-base) * 10000
            state = ('BULL' if change > base * threshold_bps else
                     'BEAR' if change < -base * threshold_bps else 'SIDEWAYS')
        sums[state]['netPnl'] += equity[i+1] - equity[i]
        sums[state]['bars'] += 1
    assert sum(s['netPnl'] for s in sums.values()) == equity[-1]-INITIAL
    return [dict(state=k, bars=v['bars'], netPnl=str(v['netPnl'])) for k,v in sums.items()]


def train(prices):
    # The selection function never receives test prices. A lower candidate number
    # wins a tie after the two predeclared sort keys.
    rows = [dict(lookback=n, metrics=run_window(prices, n)[0]) for n in LOOKBACKS]
    return sorted(rows, key=lambda row: (-Fraction(row['metrics']['totalReturn']),
                  Fraction(row['metrics']['maxDrawdown']), row['lookback']))


def fold(prices, start, boundary, end):
    rows = train(prices[start:boundary])
    locked = rows[0]['lookback']
    test_prices = prices[boundary:end]
    test_metrics, equity = run_window(test_prices, locked)
    return dict(trainRange=[start,boundary], testRange=[boundary,end], train=rows,
                selectedLookback=locked, test=test_metrics, regimes=lagged_attribution(test_prices, equity))


def seeded_grid_vector():
    # PCG reference sequence, initstate=42, stream=54; also frozen by Phase 5A.
    # Consume the first four bounded draws for partial Fisher-Yates on a 3x3 grid.
    words = [0xa15c02b7, 0x7b47f409, 0xba1d3330, 0x83d2f293]
    remaining = [(a, b) for a in LOOKBACKS for b in LOOKBACKS]
    for i, word in enumerate(words):
        choices = len(remaining) - i
        assert word >= 2**32 % choices  # no rejected words in this known sequence
        target = i + word % choices
        remaining[i], remaining[target] = remaining[target], remaining[i]
    sample = sorted(remaining[:len(words)])
    return dict(seed=42, count=len(words), candidates=[list(pair) for pair in sample])


def reference(directory):
    prices = read_prices(directory)
    check_rule(directory)
    folds = [fold(prices, 0, 24, 36), fold(prices, 12, 36, 48)]
    first, second = folds
    assert [f['selectedLookback'] for f in folds] == [1, 2]
    assert [f['test']['netPnl'] for f in folds] == ['-42', '96']
    # Counterexample for a look-ahead implementation: an unselected parameter
    # beats the locked first candidate on the unseen test prices.
    assert run_window(prices[24:36], 3)[0]['netPnl'] == '0'
    for f in folds:
        start, boundary = f['trainRange']
        end = f['testRange'][1]
        replacement = prices[:boundary] + [100] * (len(prices)-boundary)
        changed = fold(replacement, start, boundary, end)
        assert changed['train'] == f['train'] and changed['selectedLookback'] == f['selectedLookback']
        assert changed['test']['netPnl'] == '0'
    assert [r['lookback'] for r in train([100] * 24)] == [1, 2, 3]
    assert first['train'][0]['metrics']['profitFactor'] == '1'
    assert second['train'][0]['metrics']['profitFactor'] == '2.133333333333'
    return dict(source='Artificial flat OHLC; exact integer ledger and Fraction ratios in Python.',
                initialCash='1000', feeBps=0, buySlippageBps=0, sellSlippageBps=0,
                quantityDecimals=0, regime=dict(lookback=2, thresholdBps=500),
                rolling=folds, split=fold(prices, 0, 24, 48), randomGrid=seeded_grid_vector())


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--fixtures', type=Path, default=Path(__file__).resolve().parents[1] / 'fixtures')
    args = parser.parse_args()
    result = reference(args.fixtures)
    expected = args.fixtures / 'advanced-research-reference.json'
    if args.check:
        if result != json.loads(expected.read_text(encoding='utf-8')):
            raise SystemExit('Advanced research independent rolling/split fixture mismatch')
        print('Phase 5E independent oracle matched 2 rolling folds and 1 held-out split, 3 training candidates, '
              'four lagged state sums, test-suffix perturbations, deterministic ties and seeded 3x3 grid.')
    else:
        expected.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
