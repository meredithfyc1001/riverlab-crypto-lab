"""Optional independent reference, standard library only; never imports the TS engine.

Direct expressions for two specified legs, rather than the engine event loop or
integer ledger. CI consumes the checked-in constants, not freshly generated truth.
"""
from decimal import Decimal as D, localcontext, ROUND_CEILING, ROUND_FLOOR
import json

with localcontext() as ctx:
    ctx.prec = 80
    quantum = D('1e-18')
    def up(x):
        return x.quantize(quantum, rounding=ROUND_CEILING)
    def down(x):
        return x.quantize(quantum, rounding=ROUND_FLOOR)
    def text(x):
        return format(x, 'f').rstrip('0').rstrip('.') if '.' in format(x, 'f') else str(x)
    buy_price = up(D(100) * D('1.01'))
    buy_quote = up(buy_price * D(2))
    buy_fee = up(buy_quote * D('.0025'))
    buy_cash = D(1000) - buy_quote - buy_fee
    sell_price = down(D(120) * D('.98'))
    sell_quote = down(sell_price * D(2))
    sell_fee = up(sell_quote * D('.0025'))
    sell_cash = D(1000) - buy_quote - buy_fee + sell_quote - sell_fee
    expected = {
        'buy': dict(price=buy_price, quantity=D(2), notional=buy_quote, fee=buy_fee,
                    cash=buy_cash, equityAtOpen=buy_cash + D(200),
                    equityAtClose=buy_cash + D(220), deltaEquity=buy_cash + D(200) - D(1000)),
        'sell': dict(price=sell_price, quantity=D(2), notional=sell_quote, fee=sell_fee,
                     cash=sell_cash, equityAtOpen=sell_cash,
                     deltaEquity=sell_cash - (buy_cash + D(240))),
        'totalFees': text(buy_fee + sell_fee),
    }
    for side in ['buy', 'sell']:
        expected[side] = {k: text(v) for k, v in expected[side].items()}
    print(json.dumps(expected, indent=2))
