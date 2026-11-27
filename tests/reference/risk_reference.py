"""Independent PCG integer and Decimal100/Fraction bootstrap reference, no TS imports."""
import argparse
import json
from decimal import Decimal, localcontext, ROUND_FLOOR, ROUND_DOWN
from fractions import Fraction
from pathlib import Path

def pcg(seed):
    state = 0
    def draw():
        nonlocal state
        old = state
        state = (old * 6364136223846793005 + 109) % 2**64
        word = (((old >> 18) ^ old) >> 27) % 2**32
        rotation = old >> 59
        return ((word >> rotation) | (word << ((-rotation) % 32))) % 2**32
    draw()
    state = (state + seed) % 2**64
    draw()
    return draw

def dec(value):
    return format(value, 'f').rstrip('0').rstrip('.') if '.' in format(value, 'f') else format(value, 'f')

def ratio(value):
    return dec((Decimal(value.numerator) / Decimal(value.denominator)).quantize(Decimal('0.000000000001'), rounding=ROUND_DOWN))

equities = ['1000','1000','1100','990','1080','960','1060','940','1040','920','1020','900','1010','910','1030','930','1050','950','1070','970','1090']
configs = [
    dict(method='iid',seed=42,paths=20,steps=12,blockSize=1,thresholdPct=95),
    dict(method='block',seed=42,paths=20,steps=12,blockSize=5,thresholdPct=95),
    dict(method='iid',seed=0,paths=20,steps=1,blockSize=1,thresholdPct=50),
]

def sample(config, source_equities=None, *, trace_steps=None):
    draw = pcg(config['seed'])
    source = list(map(Decimal, equities if source_equities is None else source_equities))
    def bounded(n):
        threshold = (2**32) % n
        word = draw()
        while word < threshold:
            word = draw()
        return word % n
    histories, paths, draws, dd, final = [], [], [], [], []
    for path in range(config['paths']):
        capital = source[0]
        history = [capital]
        selected = []
        while len(selected) < config['steps']:
            length = config['blockSize'] if config['method'] == 'block' else 1
            first = bounded(len(source) - length)
            selected.extend(range(first, first + length))
        selected = selected[:config['steps']]
        peak, worst = capital, Fraction(0)
        hit, zero = False, False
        for index in selected:
            capital = (capital * source[index + 1] / source[index]).quantize(Decimal('0.000000000000000001'), rounding=ROUND_FLOOR)
            peak = max(peak,capital)
            worst = max(worst,Fraction(peak-capital)/Fraction(peak))
            hit = hit or capital <= source[0] * config['thresholdPct'] / 100
            zero = zero or capital == 0
            history.append(capital)
        histories.append(history)
        draws.append(selected)
        final.append(capital)
        dd.append(worst)
        paths.append(dict(path=path+1,finalEquity=dec(capital),netPnl=dec(capital-source[0]),totalReturn=ratio(Fraction(capital-source[0])/Fraction(source[0])),maxDrawdown=ratio(worst),thresholdHit=hit,zero=zero))
    rank = lambda p: (config['paths'] * p + 99) // 100 - 1
    quantiles = []
    for p in [5,50,95]:
        value = sorted(final)[rank(p)]
        quantiles.append(dict(percentile=p,finalEquity=dec(value),totalReturn=ratio(Fraction(value-source[0])/Fraction(source[0])),maxDrawdown=ratio(sorted(dd)[rank(p)])))
    bands=[]
    for step in range(config['steps']+1):
        ordered=sorted(h[step] for h in histories)
        bands.append(dict(step=step,p05=dec(ordered[rank(5)]),p50=dec(ordered[rank(50)]),p95=dec(ordered[rank(95)])))
    result = dict(config=config,indices=draws,paths=paths,quantiles=quantiles,bands=bands,meanFinalEquity=dec((sum(final)/config['paths']).quantize(Decimal('0.000000000000000001'),rounding=ROUND_FLOOR)),lossCount=sum(v<source[0] for v in final),thresholdHitCount=sum(p['thresholdHit'] for p in paths))

    if trace_steps is not None:
        result['traces'] = [dict(path=i + 1, points=[dict(step=s, equity=dec(history[s])) for s in trace_steps])
                            for i, history in enumerate(histories[:5])]
    return result

if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--check',action='store_true')
    args=parser.parse_args()
    with localcontext() as ctx:
        ctx.prec=100
        generator=pcg(42)
        words=[generator() for _ in range(6)]
        assert words == [0xa15c02b7,0x7b47f409,0xba1d3330,0x83d2f293,0xbfa4784b,0xcbed606e]
        result=dict(equities=equities,pcg42=words,cases=[sample(c) for c in configs])
        path=Path(__file__).parents[1]/'fixtures'/'risk-reference.json'
        if args.check:
            assert json.loads(path.read_text(encoding='utf-8'))==result
            print('Independent PCG32/Decimal100/Fraction risk reference matched: 3 methods/seed cases.')
        else:
            path.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
