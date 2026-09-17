"""Issue #46 prompt contract regression + eval harness unit tests.

No live Gemini calls. Execution: python -m unittest test_generate_questions test_difficulty_eval -v
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from generate_questions import ALLOWED_TYPES, DIFFICULTIES, build_prompt
from eval.blind import build_blind_pack, unblind_ratings, write_blind_artifacts
from eval.prompts_old import build_old_prompt
from eval.report import (
    DEFAULT_MIN_PER_DIFFICULTY,
    render_markdown_report,
    summarize,
)
from eval.rubric import verdict_from_bands


def _q(text, qtype="計算"):
    return {"type": qtype, "q": text, "a": "A", "opts": ["A", "B", "C", "D"]}


def _calibrated_rows(counts: dict[str, int], *, verdict: str = "FIT") -> list[dict]:
    """Build calibrated unblinded rows with given per-difficulty counts."""
    band = {"super_easy": 0, "easy": 1, "medium": 2, "hard": 3}
    rows = []
    for diff, n in counts.items():
        for i in range(n):
            rows.append(
                {
                    "id": f"cal-{diff}-{i}",
                    "version": "calibrated",
                    "difficulty": diff,
                    "rated_band": band[diff],
                    "verdict": verdict,
                    "quality_issue": False,
                    "reason": "test",
                }
            )
    return rows


class TestCalibratedPromptContract(unittest.TestCase):
    """Deterministic regression for Issue #46 difficulty contract."""

    def test_prompt_contains_four_tier_rubric(self):
        p = build_prompt()
        for token in ("super_easy", "easy", "medium", "hard"):
            self.assertIn(token, p)
        for dim in ("S 解題步驟", "WM 工作記憶", "R 推理鏈", "C 計算", "P 模式", "D 干擾"):
            self.assertIn(dim, p)

    def test_medium_and_hard_minimum_cognitive_load(self):
        p = build_prompt()
        self.assertIn("至少兩步處理", p)
        self.assertIn("WM≈6", p)
        self.assertIn("中等模式推導", p)
        self.assertIn("S≥3", p)
        self.assertIn("R≥2", p)
        self.assertIn("C=3", p)
        self.assertIn("P=3", p)
        self.assertIn("WM≥7", p)
        self.assertIn("至少一項", p)

    def test_int_override_rule_present(self):
        p = build_prompt()
        self.assertIn("INT", p)
        self.assertIn("直覺秒答", p)
        self.assertIn("禁止因冷門把常識放進 medium/hard", p)

    def test_positive_and_negative_examples_per_tier(self):
        p = build_prompt()
        # Match rubric tier bullets only (not the schema key legend line).
        markers = {
            "super_easy": "- super_easy：S≤1",
            "easy": "- easy：S=1-2",
            "medium": "- medium：最低認知負荷",
            "hard": "- hard：必須符合",
        }
        for tier, marker in markers.items():
            self.assertIn(marker, p, msg=f"{tier} rubric bullet missing")
            idx = p.index(marker)
            chunk = p[idx : idx + 320]
            self.assertIn("正例", chunk, msg=f"{tier} missing 正例")
            self.assertIn("反例", chunk, msg=f"{tier} missing 反例")

    def test_unknown_type_not_interpolated(self):
        p = build_prompt({"hard": {"惡意注入題型": 99, "計算": 1}})
        self.assertNotIn("惡意注入題型", p)
        for t in ALLOWED_TYPES:
            # whitelist types may appear in counts line
            self.assertIsInstance(t, str)

    def test_closing_json_instruction_last_line(self):
        for p in (build_prompt(), build_prompt({"easy": {"常識": 1}})):
            self.assertEqual(
                p.strip().splitlines()[-1],
                "只回傳純JSON物件，不要有任何其他文字或markdown。",
            )

    def test_old_prompt_differs_and_lacks_rubric_contract(self):
        old = build_old_prompt()
        new = build_prompt()
        self.assertNotEqual(old, new)
        self.assertIn("難度需明顯區隔", old)
        self.assertNotIn("Issue #37 rubric", old)
        self.assertIn("Issue #37 rubric", new)

    def test_old_and_new_share_schema_and_type_whitelist(self):
        old = build_old_prompt()
        new = build_prompt()
        for token in ALLOWED_TYPES:
            self.assertIn(token, old)
            self.assertIn(token, new)
        for diff in DIFFICULTIES:
            self.assertIn(diff, old)
            self.assertIn(diff, new)


class TestRubricVerdict(unittest.TestCase):
    def test_fit_too_easy_too_hard_wrong_tier(self):
        self.assertEqual(verdict_from_bands("medium", 2), "FIT")
        self.assertEqual(verdict_from_bands("medium", 1), "TOO_EASY")
        self.assertEqual(verdict_from_bands("medium", 3), "TOO_HARD")
        self.assertEqual(verdict_from_bands("hard", 0), "WRONG_TIER")
        self.assertEqual(verdict_from_bands("super_easy", 2), "WRONG_TIER")


class TestBlindUnblindReport(unittest.TestCase):
    def test_blind_strips_version_and_unblind_restores(self):
        pooled = {
            "old": {
                "hard": [_q("old hard 1？")],
                "medium": [_q("old med 1？")],
                "easy": [_q("old easy 1？")],
                "super_easy": [_q("old su 1？")],
            },
            "calibrated": {
                "hard": [_q("cal hard 1？")],
                "medium": [_q("cal med 1？")],
                "easy": [_q("cal easy 1？")],
                "super_easy": [_q("cal su 1？")],
            },
        }
        items, key = build_blind_pack(pooled, seed=42)
        self.assertEqual(len(items), 8)
        for item in items:
            self.assertIn("id", item)
            self.assertIn("difficulty", item)
            self.assertNotIn("version", item)
            # Metadata must not leak prompt version; question text may mention anything.
            self.assertTrue(item["id"].startswith("Q-"))

        ratings = []
        for item in items:
            # Mark all FIT for smoke metrics
            ratings.append(
                {
                    "id": item["id"],
                    "rated_band": {"super_easy": 0, "easy": 1, "medium": 2, "hard": 3}[
                        item["difficulty"]
                    ],
                    "verdict": "FIT",
                    "quality_issue": False,
                    "reason": "test",
                }
            )
        unblinded = unblind_ratings(ratings, key)
        versions = {r["version"] for r in unblinded}
        self.assertEqual(versions, {"old", "calibrated"})
        metrics = summarize(unblinded)
        self.assertEqual(metrics["versions"]["calibrated"]["by_difficulty"]["medium"]["fit_rate"], 1.0)
        # 1 rated item per difficulty is below Issue #46 minimum → PENDING, not PASS
        self.assertEqual(metrics["acceptance"]["overall"], "PENDING")
        self.assertFalse(metrics["acceptance"]["sample_complete"])
        self.assertEqual(metrics["acceptance"]["required_n"], DEFAULT_MIN_PER_DIFFICULTY)

    def test_quality_issue_independent_of_verdict(self):
        unblinded = [
            {
                "id": "Q1",
                "version": "calibrated",
                "difficulty": "hard",
                "rated_band": 3,
                "verdict": "FIT",
                "quality_issue": True,
                "reason": "退化題但仍 FIT band",
            }
        ]
        # Pad minimal rows so summarize has structure; other diffs empty OK
        metrics = summarize(unblinded)
        hard = metrics["versions"]["calibrated"]["by_difficulty"]["hard"]
        self.assertEqual(hard["counts"]["FIT"], 1)
        self.assertEqual(hard["quality_issue_count"], 1)

    def test_write_blind_artifacts_creates_sheet(self):
        pooled = {
            "old": {d: [_q(f"o {d}？")] for d in DIFFICULTIES},
            "calibrated": {d: [_q(f"c {d}？")] for d in DIFFICULTIES},
        }
        items, key = build_blind_pack(pooled, seed=1)
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            write_blind_artifacts(out, items, key)
            self.assertTrue((out / "pack.json").exists())
            self.assertTrue((out / "key.json").exists())
            self.assertTrue((out / "rating_sheet.csv").exists())
            self.assertTrue((out / "RUBRIC.txt").exists())


class TestAcceptancePendingWithoutRatings(unittest.TestCase):
    def test_empty_calibrated_is_pending(self):
        metrics = summarize([])
        self.assertEqual(metrics["acceptance"]["overall"], "PENDING")
        self.assertFalse(metrics["acceptance"]["sample_complete"])


class TestAcceptanceSampleSizeEnforcement(unittest.TestCase):
    """Issue #46: AC must not PASS on incomplete rated samples."""

    def test_single_fit_item_must_not_pass(self):
        rows = _calibrated_rows({d: 1 for d in DIFFICULTIES})
        metrics = summarize(rows)
        self.assertEqual(metrics["acceptance"]["calibrated_medium_fit"]["status"], "PENDING")
        self.assertEqual(metrics["acceptance"]["calibrated_hard_fit"]["status"], "PENDING")
        self.assertEqual(
            metrics["acceptance"]["calibrated_overall_too_hard"]["status"], "PENDING"
        )
        self.assertEqual(metrics["acceptance"]["overall"], "PENDING")
        self.assertFalse(metrics["acceptance"]["sample_complete"])

    def test_medium_29_must_not_pass(self):
        counts = {d: DEFAULT_MIN_PER_DIFFICULTY for d in DIFFICULTIES}
        counts["medium"] = DEFAULT_MIN_PER_DIFFICULTY - 1  # 29
        metrics = summarize(_calibrated_rows(counts))
        med = metrics["acceptance"]["calibrated_medium_fit"]
        self.assertEqual(med["n"], 29)
        self.assertEqual(med["required_n"], DEFAULT_MIN_PER_DIFFICULTY)
        self.assertFalse(med["sample_complete"])
        self.assertEqual(med["status"], "PENDING")
        self.assertEqual(metrics["acceptance"]["overall"], "PENDING")
        self.assertFalse(metrics["acceptance"]["sample_complete"])

    def test_hard_29_must_not_pass(self):
        counts = {d: DEFAULT_MIN_PER_DIFFICULTY for d in DIFFICULTIES}
        counts["hard"] = DEFAULT_MIN_PER_DIFFICULTY - 1  # 29
        metrics = summarize(_calibrated_rows(counts))
        hard = metrics["acceptance"]["calibrated_hard_fit"]
        self.assertEqual(hard["n"], 29)
        self.assertEqual(hard["required_n"], DEFAULT_MIN_PER_DIFFICULTY)
        self.assertFalse(hard["sample_complete"])
        self.assertEqual(hard["status"], "PENDING")
        self.assertEqual(metrics["acceptance"]["overall"], "PENDING")
        self.assertFalse(metrics["acceptance"]["sample_complete"])

    def test_all_four_ge_30_enters_threshold_judgment(self):
        counts = {d: DEFAULT_MIN_PER_DIFFICULTY for d in DIFFICULTIES}
        metrics = summarize(_calibrated_rows(counts))
        ac = metrics["acceptance"]
        self.assertTrue(ac["sample_complete"])
        self.assertTrue(all(ac["sample_complete_by_difficulty"].values()))
        self.assertEqual(ac["calibrated_medium_fit"]["status"], "PASS")
        self.assertEqual(ac["calibrated_hard_fit"]["status"], "PASS")
        self.assertEqual(ac["calibrated_overall_too_hard"]["status"], "PASS")
        self.assertEqual(ac["overall"], "PASS")

    def test_incomplete_sample_overall_ac_pending(self):
        # Even with perfect FIT rates, missing one tier keeps overall PENDING.
        counts = {
            "super_easy": DEFAULT_MIN_PER_DIFFICULTY,
            "easy": DEFAULT_MIN_PER_DIFFICULTY,
            "medium": DEFAULT_MIN_PER_DIFFICULTY,
            "hard": DEFAULT_MIN_PER_DIFFICULTY - 1,
        }
        metrics = summarize(_calibrated_rows(counts))
        self.assertEqual(metrics["acceptance"]["overall"], "PENDING")
        self.assertEqual(
            metrics["acceptance"]["calibrated_overall_too_hard"]["status"], "PENDING"
        )

    def test_meta_min_per_difficulty_overrides_constant(self):
        # With meta floor=2, two FIT per tier is enough to enter threshold judgment.
        rows = _calibrated_rows({d: 2 for d in DIFFICULTIES})
        metrics = summarize(rows, meta={"min_per_difficulty": 2})
        self.assertEqual(metrics["acceptance"]["required_n"], 2)
        self.assertTrue(metrics["acceptance"]["sample_complete"])
        self.assertEqual(metrics["acceptance"]["overall"], "PASS")

    def test_report_shows_rated_required_and_sample_complete(self):
        counts = {d: 1 for d in DIFFICULTIES}
        metrics = summarize(_calibrated_rows(counts))
        md = render_markdown_report(metrics)
        self.assertIn("Required n per difficulty", md)
        self.assertIn("sample-complete", md.lower())
        self.assertIn("sample-complete=NO", md)
        self.assertIn(f"rated n=1/required {DEFAULT_MIN_PER_DIFFICULTY}", md)


if __name__ == "__main__":
    unittest.main()
