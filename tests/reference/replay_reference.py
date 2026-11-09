"""Independent Decimal hand-order ledger, no TS implementation imports."""
import argparse
import json
from decimal import Decimal, localcontext
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--check", action="store_true")
parser.parse_args()
expected = json.loads((Path(__file__).parents[1] / "fixtures" / "replay-reference.json").read_text(encoding="utf-8"))
with localcontext() as context:
    context.prec = 100
    cash, quantity, basis, realized, fees = map(Decimal, [1000, 0, 0, 0, 0])
    # Submitted at earlier close, hand scheduled for next opens only.
    orders = {1: ("buy", Decimal(1)), 3: ("sell", Decimal(1)), 4: ("buy", Decimal(2))}
    equities = []
    for index, price in enumerate(expected["opens"]):
        price = Decimal(price)
        if index in orders:
            side, qty = orders[index]
            execution_price = price * (Decimal("1.001") if side == "buy" else Decimal("0.999"))
            notional = qty * execution_price
            fee = notional * Decimal("0.001")
            fees += fee
            if side == "buy":
                cash -= notional + fee
                quantity += qty
                basis += notional + fee
            else:
                allocation = basis * qty / quantity
                cash += notional - fee
                realized += notional - fee - allocation
                basis -= allocation
                quantity -= qty
        equities.append(cash + quantity * price)
    for actual, wanted in zip(equities, expected["equities"], strict=True):
        assert actual == Decimal(wanted)
    final = cash + quantity * expected["opens"][-1]
    for actual, key in [(cash,"cash"),(quantity,"quantity"),(final,"equity"),(realized,"realized"),(quantity*expected["opens"][-1]-basis,"unrealized"),(final-1000,"net"),(fees,"fees")]:
        assert actual == Decimal(expected[key]), key
    assert realized + (quantity * expected["opens"][-1] - basis) == final - 1000
print("Independent replay Decimal reference passed: next-open fees, cash, equity, realized/open pnl.")
