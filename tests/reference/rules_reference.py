"""Independent Decimal100 prefix formulas, including three-valued groups and edge signals.
No TS, generated output, libraries, clock or network used as numerical input.
"""
import argparse
import json
from decimal import Decimal, localcontext
from pathlib import Path

CLOSES = [100, 100, 100, 110, 120, 95, 85, 85, 105, 115, 90, 100, 125, 80, 80, 110]

def avg(values, n, kind):
    if len(values) < n:
        return None
    value = sum(values[:n]) / n
    if kind == 'MA':
        return sum(values[-n:]) / n
    alpha = Decimal(2) / (n + 1)
    for close in values[n:]:
        value = alpha * close + (1 - alpha) * value
    return value

def rsi(values, n):
    changes = [b-a for a,b in zip(values, values[1:])]
    if len(changes) < n:
        return None
    gain = sum(max(x, 0) for x in changes[:n]) / n
    loss = sum(max(-x, 0) for x in changes[:n]) / n
    for x in changes[n:]:
        gain = (gain * (n - 1) + max(x, 0)) / n
        loss = (loss * (n - 1) + max(-x, 0)) / n
    return Decimal(50) if gain == loss == 0 else Decimal(100) if loss == 0 else Decimal(0) if gain == 0 else Decimal(100) * gain / (gain + loss)

def cmp(a, b, op):
    return {'gt': a>b, 'gte': a>=b, 'lt': a<b, 'lte': a<=b}[op]

def evaluate(c, values):
    kind = c['kind']
    if kind == 'cross':
        f, s = c['fastPeriod'], c['slowPeriod']
        if len(values) <= s:
            return None
        past = avg(values[:-1], f, c['average']) - avg(values[:-1], s, c['average'])
        current = avg(values, f, c['average']) - avg(values, s, c['average'])
        return past <= 0 < current if c['direction'] == 'above' else past >= 0 > current
    if kind == 'price-ma':
        a = avg(values, c['period'], c['average'])
        return None if a is None else cmp(values[-1], a, c['operator'])
    if kind == 'rsi':
        value = rsi(values, c['period'])
        return None if value is None else cmp(value, Decimal(c['threshold']), c['operator'])
    n = c['lookback']
    if len(values) <= n:
        return None
    # Fixtures use high=low=close; current root deliberately excluded.
    return values[-1] > max(values[-n-1:-1]) if c['direction'] == 'above' else values[-1] < min(values[-n-1:-1])

def group(g, values):
    if not g['enabled']:
        return False
    values = [evaluate(c, values) for c in g['conditions'] if c['enabled']]
    if None in values:
        return None
    return all(values) if g['operator'] == 'AND' else any(values)

def decisions(rule, closes):
    result, previous = [], (False, False)
    for i in range(1, len(closes)+1):
        b, s = (group(rule[side], list(map(Decimal, closes[:i]))) for side in ['buy','sell'])
        action, reason = 'hold', 'rules-warmup'
        if b is not None and s is not None:
            if b and s:
                reason = 'rules-conflict'
            elif b and not previous[0]:
                action, reason = 'buy', 'rules-buy'
            elif s and not previous[1]:
                action, reason = 'sell', 'rules-sell'
            else:
                reason = 'rules-repeat' if b or s else 'rules-no-match'
            previous = b, s
        result.append(dict(action=action, reason=reason))
    return result

def condition(kind, **parameters):
    return dict(kind=kind, enabled=True, **parameters)

def rule(buy, sell=None, op='AND'):
    return dict(schemaVersion=1, revision=1,
        buy=dict(enabled=True, operator=op, conditions=buy),
        sell=dict(enabled=sell is not None, operator='AND', conditions=sell or [condition('rsi',period=2,operator='gte',threshold=70)]))

def generate():
    cases = []
    def add(name, config, closes=CLOSES):
        cases.append(dict(name=name, rule=config, closes=closes, expected=decisions(config, closes)))
    for average in ['MA','EMA']:
        for direction in ['above','below']:
            add(f'{average} cross {direction}', rule([condition('cross',average=average,fastPeriod=2,slowPeriod=3,direction=direction)]))
        for op in ['gt','gte','lt','lte']:
            add(f'price {average} {op}',rule([condition('price-ma',average=average,period=3,operator=op)]))
            add(f'constant price {average} {op}',rule([condition('price-ma',average=average,period=1,operator=op)]),[100]*6)
    for op in ['gt','gte','lt','lte']:
        for threshold in [0,50,100]:
            add(f'RSI {op} {threshold}',rule([condition('rsi',period=2,operator=op,threshold=threshold)]))
        add(f'constant RSI {op}',rule([condition('rsi',period=2,operator=op,threshold=50)]),[100]*6)
    for direction in ['above','below']:
        add(f'breakout {direction}',rule([condition('breakout',lookback=2,direction=direction)]))
    a = condition('price-ma',average='MA',period=2,operator='gte')
    b = condition('rsi',period=4,operator='lte',threshold=70)
    for op in ['AND','OR']:
        add(f'{op} and unknown',rule([a,b],op=op))
        add(f'{op} dual',rule([a,b],[condition('breakout',lookback=2,direction='below')],op=op))
    add('conflict consumes both edges',rule([a],[a]))
    return cases

parser=argparse.ArgumentParser()
parser.add_argument('--check', action='store_true')
args=parser.parse_args()
path=Path(__file__).resolve().parents[1]/'fixtures'/'rules-reference.json'
with localcontext() as context:
    context.prec=100
    output=generate()
if args.check:
    assert json.loads(path.read_text()) == output, 'Independent rules reference differs'
    print(f'Independent Decimal100 rules reference passed: {len(output)} condition/group cases.')
else:
    path.write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n')
