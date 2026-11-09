"""Independent Decimal reference: hand-declared next-open trades, integer base units.
No imports from the TS strategy, engine or statistics implementation.
"""
import argparse
import json
from decimal import Decimal, ROUND_FLOOR
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--check", action="store_true")
parser.parse_args()
path = Path(__file__).parents[1] / "fixtures" / "research-reference.json"
expected = json.loads(path.read_text(encoding="utf-8"))
cash = Decimal(1000)
quantity = Decimal(0)
realized = Decimal(0)
cost = Decimal(0)
# Independently hand worked breakout(1): buy next open after rises,
# sell next open after falls. Last sell has no next open and expires.
completed = []
for side, price in [("buy", 100), ("sell", 120), ("buy", 110), ("sell", 130), ("buy", 140)]:
    price = Decimal(price)
    if side == "buy":
        quantity = (cash / price).to_integral_value(rounding=ROUND_FLOOR)
        cost = quantity * price
        cash -= cost
    else:
        pnl = quantity * price - cost
        completed.append(pnl)
        realized += pnl
        cash += quantity * price
        quantity = Decimal(0)
        cost = Decimal(0)
equity = cash + quantity * Decimal(120)
assert str(cash) == expected["finalCash"]
assert str(quantity) == expected["finalQuantity"]
assert str(equity) == expected["finalEquity"]
assert str(realized) == expected["realizedPnl"]
assert str(quantity * 120 - cost) == expected["unrealizedPnl"]
assert str(equity - 1000) == expected["netPnl"]
assert str((equity - 1000) / 1000) == expected["totalReturn"]
assert str((Decimal(200) / 1400).quantize(Decimal(".000000000001"), rounding=ROUND_FLOOR)) == expected["maxDrawdown"]
assert len(completed) == expected["completedTradeCount"] == 2
assert all(p > 0 for p in completed)
assert expected["winRate"] == "1"
assert expected["benchmarkReturn"] == str((Decimal(10) * 120 - 1000) / 1000)
assert expected["trainEquity"] == "1200"  # first window closes in cash
assert expected["testEquity"] == str(Decimal(1000) % 140 + (Decimal(1000) // 140) * 120)
print("Independent Phase 3 Decimal references passed: full / isolated train / test.")
