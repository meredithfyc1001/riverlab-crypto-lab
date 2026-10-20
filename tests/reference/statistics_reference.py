"""Independent Decimal reference, no TS imports. Fixed flat-to-flat episodes with an open remainder."""
from decimal import Decimal as D, getcontext, ROUND_DOWN
import json
from pathlib import Path
getcontext().prec = 90
cash = D(1000)
qty = D(0)
cost = D(0)
realized = D(0)
fee_sum = D(0)
# Each tuple: side, reference price, quantity. 100bps fees, 100bps adverse each side.
trades = [('buy',100,2), ('sell',120,2), ('buy',100,1), ('sell',80,1), ('buy',100,1)]
closed = []
for side,ref,q in trades:
    q=D(q); price=D(ref)*(D('1.01') if side=='buy' else D('.99'))
    notional=price*q; fee=notional*D('.01'); fee_sum+=fee
    if side=='buy':
        cash-=notional+fee;qty+=q;cost+=notional+fee
    else:
        pnl=notional-fee-cost;realized+=pnl;closed.append(pnl)
        cash+=notional-fee;qty-=q;cost=D(0)
mark=D(110)
equity=cash+qty*mark
fmt=lambda v:format(v,'f').rstrip('0').rstrip('.') if '.' in format(v,'f') else str(v)
ratio=lambda a,b: fmt((a/b).quantize(D('0.000000000001'),rounding=ROUND_DOWN))
# Passive all-in, q down to 8 decimals; fee ceil to 18 places (independent direct Decimal).
quant=D('0.000000000000000001')
bq=(D(1000)/(D(101)*D('1.01'))).quantize(D('.00000001'),rounding=ROUND_DOWN)
bn=bq*D(101);bf=(bn*D('.01')).quantize(quant,rounding='ROUND_UP')
bcash=D(1000)-bn-bf;bfinal=bcash+bq*mark
out=dict(cash=fmt(cash),quantity=fmt(qty),equity=fmt(equity),netPnl=fmt(equity-D(1000)),realizedPnl=fmt(realized),unrealizedPnl=fmt(qty*mark-cost),fees=fmt(fee_sum),remainingCostBasis=fmt(cost),winRate='0.5',profitFactor=ratio(closed[0],-closed[1]),totalReturn=ratio(equity-D(1000),D(1000)),benchmark=dict(quantity=fmt(bq),fee=fmt(bf),cash=fmt(bcash),finalEquity=fmt(bfinal),netPnl=fmt(bfinal-D(1000)),return_=ratio(bfinal-D(1000),D(1000))))
path=Path(__file__).parent.parent/'fixtures/statistics-reference.json'
text=json.dumps(out,indent=2)+'\n'
if '--check' in __import__('sys').argv:
    assert path.read_text()==text
    print('Independent Decimal90 statistics reference matched')
else:path.write_text(text)
