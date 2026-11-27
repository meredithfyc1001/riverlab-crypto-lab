"""Boundary tests for independent synthetic migration numerics and SQLite verification."""

from contextlib import closing
from copy import deepcopy
from decimal import localcontext
import gzip
import json
from pathlib import Path
import sqlite3
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "phase6c"))
from historical_reference import advanced_plan, check_statistics, indicators, portfolio, replay
from reference_ledger import historical_hash, run_ledger, signals, units
from verify_candidate import check_schema
from advanced_research_reference import seeded_grid_vector

FIXTURES = ROOT / "tests" / "fixtures"


def bars(prices):
    return [
        dict(timestampUtcMs=i * 60000, open=p, high=p, low=p, close=p, volume=1) for i, p in enumerate(prices)
    ]


def config():
    return dict(
        initialCash="1000", feeBps=0, buySlippageBps=0, sellSlippageBps=0, quantityDecimals=6, minNotional="0"
    )


class IndependentOracleTests(unittest.TestCase):
    def test_all_independent_rule_vectors(self):
        for case in json.loads((FIXTURES / "rules-reference.json").read_text(encoding="utf-8")):
            with self.subTest(case=case["name"]):
                result = signals(bars(case["closes"]), {"kind": "rules", "rule": case["rule"]})
                self.assertEqual(
                    [{k: row[k] for k in ("action", "reason")} for row in result], case["expected"]
                )

    def test_wilder_rsi_inclusive_bounds_and_warmup(self):
        result = signals(bars([10, 10, 10, 12, 10, 8]), dict(kind="rsi", period=2, lower=35, upper=75))
        self.assertEqual([r["action"] for r in result], ["hold", "hold", "hold", "sell", "buy", "buy"])
        self.assertEqual([r["reason"] for r in result[:3]], ["warmup", "warmup", "rsi-middle"])

    def test_zero_initial_cash_retains_undefined_returns_and_drawdowns(self):
        tape = bars([100, 99])
        params = dict(config(), initialCash="0", quantityDecimals=0)
        intent = dict(candleIndex=0, action="buy", reason="manual-buy", quantity="all")
        ledger, _ = run_ledger(tape, params, 60000, [intent], interactive=True)
        self.assertEqual(ledger["orders"][0]["reason"], "zero-quantity")
        values = indicators(ledger, 0)
        self.assertIsNone(values["metrics"]["totalReturn"])
        self.assertIsNone(values["metrics"]["maxDrawdown"])

        def unavailable(reason):
            return dict(value=None, reason=reason)

        no_benchmark = unavailable("基准买入被拒绝：zero-quantity")
        expected = dict(
            curve=[
                dict(
                    timestampUtcMs=i * 60000,
                    equity="0",
                    drawdown=unavailable("峰值权益为0"),
                    benchmarkEquity=None,
                )
                for i in range(3)
            ],
            realizedPnl="0",
            remainingCostBasis="0",
            unrealizedPnl="0",
            winRate=unavailable("没有已完成交易"),
            maxDrawdownAmount="0",
            maxDrawdownDurationMs=0,
            ongoingDrawdownMs=0,
            exposedMs=0,
            exposureFraction="0",
            annualizedReturn=unavailable("需要至少365天且252根有效收盘样本"),
            benchmark={
                "return": no_benchmark,
                "netPnl": no_benchmark,
                "finalEquity": no_benchmark,
                "fee": "0",
                "quantity": "0",
                "cash": "0",
            },
        )
        check_statistics(expected, ledger, values, dict(candles=tape, parsing={"intervalMs": 60000}), params)

    def test_partial_sale_assigns_remaining_cost_to_final_exit(self):
        tape = bars([10, 10, 12, 11])
        decisions = [
            dict(candleIndex=i, action=a, quantity=q, reason="manual-" + a)
            for i, (a, q) in enumerate([("buy", "3"), ("sell", "1"), ("sell", "2")])
        ]
        ledger, pending = run_ledger(tape, config(), 60000, decisions, interactive=True)
        self.assertIsNone(pending)
        self.assertEqual([c["account"]["equity"] for c in ledger["closes"]], ["1000", "1000", "1006", "1004"])
        result = indicators(ledger, units("1000"))
        self.assertEqual(result["trades"], [dict(entryCandleIndex=1, exitCandleIndex=3, netPnl="4")])
        self.assertEqual(result["realized"], units("4"))
        self.assertEqual(result["cost"], 0)

    def test_legacy_checkpoint_rejects_unrevealed_cursor(self):
        data = {"id": "d", "file": {"sha256": "f" * 64}, "symbol": "SYN"}
        payload = dict(
            datasetId="d", sourceHash=historical_hash(data), sourceFileSha256="f" * 64, symbol="SYN", cursor=0
        )
        with closing(sqlite3.connect(":memory:")) as db:
            db.execute("create table records(kind,id,body)")
            db.execute("insert into records values(?,?,?)", ("dataset", "d", json.dumps(data)))
            with self.assertRaisesRegex(ValueError, "at least one revealed bar"):
                replay(dict(payload=payload, payloadHash=historical_hash(payload)), db)

    def test_resealing_an_incorrect_synthetic_protected_fill_still_fails(self):
        with gzip.open(FIXTURES / "phase-5c-a-synthetic.json.gz", "rt", encoding="utf-8") as f:
            original = json.load(f)
        with localcontext() as ctx:
            ctx.prec = 250
            self.assertEqual(portfolio(original)["fills"], 6)
            corrupted = deepcopy(original)
            fill = next(
                f
                for child in corrupted["result"]["assets"]
                for f in child["result"]["fills"]
                if "trigger" in f
            )
            fill["fee"] = "0"
            corrupted["payloadHash"] = historical_hash({k: corrupted[k] for k in ("input", "result")})
            corrupted["recordHash"] = historical_hash(
                {k: v for k, v in corrupted.items() if k not in ("recordHash", "input", "result")}
            )
            with self.assertRaisesRegex(ValueError, "all orders, fills"):
                portfolio(corrupted)

    def test_independent_random_sampling_and_disjoint_rolling_windows(self):
        record = json.loads((FIXTURES / "phase-5e-breakout-rule.json").read_text(encoding="utf8"))
        spec = dict(
            ruleRecord=record,
            axes=[
                dict(side=side, condition=0, field="lookback", min=1, max=3, step=1)
                for side in ("buy", "sell")
            ],
            dataset=dict(candles=bars(range(1, 21))),
            search=dict(kind="random", seed=42, count=4),
            evaluation=dict(kind="rolling", trainBars=8, testBars=4),
        )
        plan = advanced_plan(spec)
        expected = seeded_grid_vector()
        self.assertEqual([x["values"] for x in plan["candidates"]], expected["candidates"])
        self.assertEqual(
            [(w["start"], w["end"]) for w in plan["windows"]],
            [(0, 8), (8, 12), (4, 12), (12, 16), (8, 16), (16, 20)],
        )

    def test_schema_rejects_mislabeled_tables_without_composite_primary_keys(self):
        with closing(sqlite3.connect(":memory:")) as db:
            db.execute("create table records(kind text, id text, body text) strict")
            with self.assertRaisesRegex(ValueError, "STRICT WITHOUT ROWID"):
                check_schema(db)


if __name__ == "__main__":
    unittest.main()
