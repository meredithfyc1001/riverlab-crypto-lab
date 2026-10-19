"""Independent Decimal/brute-window oracle; never imports or runs TypeScript.
Run: python3 tests/reference/phase2b_reference.py --check
Without --check, writes the reviewed fixed JSON fixture. Python is not an app/CI dependency.
"""
from decimal import Decimal as D, localcontext, ROUND_CEILING, ROUND_FLOOR
import json
from pathlib import Path
import sys

DEST = Path(__file__).resolve().parents[1] / 'fixtures' / 'phase2b-reference.json'


def reference():
    cases = []
    prices = {
        'rise': list(range(10, 30)),
        'fall': list(range(30, 10, -1)),
        'flat': [10] * 20,
        'turns': [10, 9, 8, 9, 11, 13, 12, 10, 7, 6, 8, 11, 15, 16, 12, 7, 8, 9, 13, 10],
        'jumps': [10, 10, 50, 2, 2, 40, 41, 1, 10, 20, 30, 2, 40, 10],
        'extremes': ['1e-18', '1e29', '1e-18', '1e-18', '2e-18', '3e-18', '1e29', '1e-18'],
    }
    configs = [dict(kind='ma', fastPeriod=2, slowPeriod=4), dict(kind='rsi', period=3, lower=30, upper=70), dict(kind='breakout', lookback=3)]
    with localcontext() as ctx:
        ctx.prec = 100
        for name, values in prices.items():
            closes = [D(str(x)) for x in values]
            # Flat OHLC intentionally includes equality; custom high/low cases are tested separately.
            bars = [[str(x)] * 4 for x in closes]
            for config in configs:
                actions, last_diff = [], None
                for i, price in enumerate(closes):
                    action = 'hold'
                    if config['kind'] == 'ma' and i+1 >= config['slowPeriod']:
                        fast = sum(closes[i-config['fastPeriod']+1:i+1]) / config['fastPeriod']
                        slow = sum(closes[i-config['slowPeriod']+1:i+1]) / config['slowPeriod']
                        diff = fast - slow
                        if last_diff is not None:
                            if last_diff <= 0 < diff:
                                action = 'buy'
                            elif last_diff >= 0 > diff:
                                action = 'sell'
                        last_diff = diff
                    elif config['kind'] == 'rsi' and i >= config['period']:
                        n = config['period']
                        changes = [closes[j]-closes[j-1] for j in range(1, i+1)]
                        g = sum((max(v, D(0)) for v in changes[:n]), D(0))/n
                        loss = sum((max(-v, D(0)) for v in changes[:n]), D(0))/n
                        # Recompute independently from seed for each prefix.
                        for change in changes[n:]:
                            g = (g*(n-1)+max(change,0))/n
                            loss = (loss*(n-1)+max(-change,0))/n
                        rsi = D(50) if g == loss == 0 else D(100) if loss == 0 else 100*g/(g+loss)
                        action = 'buy' if rsi <= config['lower'] else 'sell' if rsi >= config['upper'] else 'hold'
                    elif config['kind'] == 'breakout' and i >= config['lookback']:
                        window = closes[i-config['lookback']:i]
                        action = 'buy' if price > max(window) else 'sell' if price < min(window) else 'hold'
                    actions.append(action)
                cases.append(dict(name=f"{name}-{config['kind']}", config=config, bars=bars, actions=actions))
        quantum = D('1e-18')
        def rounded(v, mode):
            return v.quantize(quantum, rounding=mode)
        def text(v):
            return format(v, 'f').rstrip('0').rstrip('.') if '.' in format(v, 'f') else str(v)
        entry = rounded(D(100)*D('1.01'), ROUND_CEILING)
        buy_quote = rounded(entry*2, ROUND_CEILING)
        buy_fee = rounded(buy_quote*D('.0025'), ROUND_CEILING)
        stop, take = rounded(entry*D('.9'), ROUND_FLOOR), rounded(entry*D('1.2'), ROUND_CEILING)
        risk = []
        for name, quote in [('stop', stop), ('take', take), ('gap-stop', D(80)), ('gap-take', take), ('both', stop)]:
            price = rounded(quote*D('.998'), ROUND_FLOOR)
            notional = rounded(price*2, ROUND_FLOOR)
            fee = rounded(notional*D('.0025'), ROUND_CEILING)
            risk.append(dict(name=name, entry=text(entry), stop=text(stop), take=text(take), reference=text(quote), price=text(price), notional=text(notional), fee=text(fee), finalCash=text(D(1000)-buy_quote-buy_fee+notional-fee), totalFees=text(buy_fee+fee)))
    return dict(provenance='Artificial OHLC; Python Decimal precision100 and brute historical windows; no TS output used.', strategies=cases, risk=risk)


if __name__ == '__main__':
    result = reference()
    if '--check' in sys.argv:
        assert json.loads(DEST.read_text()) == result, 'Reference fixture differs'
        print(f'Independent Decimal reference matches: {len(result["strategies"])} strategy cases, {len(result["risk"])} risk cases')
    else:
        DEST.write_text(json.dumps(result, indent=2) + '\n')
