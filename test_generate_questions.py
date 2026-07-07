"""generate_questions.py 的格式驗證單元測試。

依 BDD Specs 撰寫（TDD 第一步），涵蓋：
- 合法格式 → 通過驗證，回傳 True
- 缺少必要欄位（如 a / answer）→ 驗證失敗，raise Exception
- 非 JSON 字串 → 驗證失敗，raise Exception
- 題目數不足（0 題）→ 驗證失敗，raise Exception

執行：python -m unittest test_generate_questions -v
"""

import copy
import unittest

from generate_questions import (
    DIFFICULTIES,
    MAX_PER_DIFFICULTY,
    MIN_PER_DIFFICULTY,
    TYPE_CAP,
    compute_type_counts,
    merge_question_banks,
    normalize_question_text,
    parse_response_text,
    validate_questions,
)


def _make_question(answer="A", text="1 + 1 = ?"):
    return {"type": "計算", "q": text, "a": answer, "opts": ["A", "B", "C", "D"]}


def _make_valid_data():
    data = {}
    for diff in DIFFICULTIES:
        data[diff] = [
            _make_question(text=f"{diff} 範例題 {i}？")
            for i in range(MIN_PER_DIFFICULTY)
        ]
    return data


class TestBuildPrompt(unittest.TestCase):
    def test_no_args_backward_compatible(self):
        from generate_questions import build_prompt

        p = build_prompt()
        self.assertIn("純 JSON", p)
        self.assertNotIn("請優先產生數量最少的題型", p)

    def test_ends_with_closing_instruction(self):
        from generate_questions import build_prompt

        for p in (build_prompt(), build_prompt({"hard": {"計算": 5}})):
            self.assertEqual(
                p.strip().splitlines()[-1],
                "只回傳純JSON物件，不要有任何其他文字或markdown。",
            )

    def test_type_counts_names_rarest_types(self):
        from generate_questions import ALLOWED_TYPES, build_prompt

        counts = {"hard": {t: 50 for t in ALLOWED_TYPES}}
        counts["hard"]["常識"] = 1
        counts["hard"]["邏輯"] = 2
        counts["hard"]["推理"] = 3
        p = build_prompt(counts)
        self.assertIn("請優先產生數量最少的題型：常識、邏輯、推理", p)

    def test_unknown_type_keys_not_interpolated(self):
        from generate_questions import build_prompt

        p = build_prompt({"hard": {"惡意注入題型": 1}})
        self.assertNotIn("惡意注入題型", p)


class TestParseResponseText(unittest.TestCase):
    def test_plain_json_object(self):
        data = parse_response_text('{"hard": []}')
        self.assertEqual(data, {"hard": []})

    def test_json_wrapped_in_markdown_fence(self):
        text = '```json\n{"hard": []}\n```'
        data = parse_response_text(text)
        self.assertEqual(data, {"hard": []})

    def test_non_json_string_raises(self):
        with self.assertRaises(ValueError):
            parse_response_text("這不是 JSON，只是一段普通文字")

    def test_empty_string_raises(self):
        with self.assertRaises(ValueError):
            parse_response_text("")


class TestValidateQuestions(unittest.TestCase):
    def test_valid_data_returns_true(self):
        self.assertTrue(validate_questions(_make_valid_data()))

    def test_missing_answer_field_raises(self):
        data = _make_valid_data()
        del data["hard"][0]["a"]
        with self.assertRaises(ValueError):
            validate_questions(data)

    def test_missing_q_field_raises(self):
        data = _make_valid_data()
        del data["medium"][0]["q"]
        with self.assertRaises(ValueError):
            validate_questions(data)

    def test_missing_difficulty_key_raises(self):
        data = _make_valid_data()
        del data["super_easy"]
        with self.assertRaises(ValueError):
            validate_questions(data)

    def test_zero_questions_raises(self):
        data = _make_valid_data()
        data["hard"] = []
        with self.assertRaises(ValueError):
            validate_questions(data)

    def test_insufficient_questions_raises(self):
        data = _make_valid_data()
        data["easy"] = [_make_question()]  # 少於 MIN_PER_DIFFICULTY
        with self.assertRaises(ValueError):
            validate_questions(data)

    def test_answer_not_in_options_raises(self):
        data = _make_valid_data()
        data["hard"][0] = {
            "type": "計算",
            "q": "1 + 1 = ?",
            "a": "Z",
            "opts": ["A", "B", "C", "D"],
        }
        with self.assertRaises(ValueError):
            validate_questions(data)

    def test_duplicate_options_raise(self):
        data = _make_valid_data()
        data["hard"][0]["opts"] = ["A", "A", "C", "D"]
        with self.assertRaises(ValueError):
            validate_questions(data)

    def test_opts_not_list_raises(self):
        data = _make_valid_data()
        data["hard"][0]["opts"] = "not-a-list"
        with self.assertRaises(ValueError):
            validate_questions(data)

    def test_top_level_not_dict_raises(self):
        with self.assertRaises(ValueError):
            validate_questions(["not", "a", "dict"])

    def test_question_not_dict_raises(self):
        data = _make_valid_data()
        data["hard"][0] = "not-a-dict"
        with self.assertRaises(ValueError):
            validate_questions(data)


class TestNormalizeQuestionText(unittest.TestCase):
    def test_fullwidth_folds_to_halfwidth(self):
        self.assertEqual(
            normalize_question_text("1＋1＝？"), normalize_question_text("1+1=?")
        )

    def test_cjk_punctuation_variants_collide(self):
        self.assertEqual(
            normalize_question_text("甲、乙、丙"), normalize_question_text("甲，乙，丙")
        )

    def test_whitespace_removed(self):
        self.assertEqual(
            normalize_question_text("1 + 1 = ?"), normalize_question_text("1+1=?")
        )

    def test_different_questions_do_not_collide(self):
        self.assertNotEqual(
            normalize_question_text("1+1=?"), normalize_question_text("1+2=?")
        )


class TestComputeTypeCounts(unittest.TestCase):
    def test_counts_per_difficulty_and_type(self):
        bank = {diff: [] for diff in DIFFICULTIES}
        bank["hard"] = [
            _make_question(text="a？"),
            _make_question(text="b？"),
            dict(_make_question(text="c？"), type="邏輯"),
        ]
        counts = compute_type_counts(bank)
        self.assertEqual(counts["hard"], {"計算": 2, "邏輯": 1})
        self.assertEqual(counts["easy"], {})

    def test_tolerates_dirty_data(self):
        counts = compute_type_counts({"hard": ["not-a-dict", {"type": "  "}]})
        self.assertEqual(counts["hard"], {})
        self.assertEqual(counts["medium"], {})


class TestMergeQuestionBanks(unittest.TestCase):
    def _bank(self, texts):
        # 各難度使用不同題文（加上難度前綴），避免觸發跨難度去重，
        # 讓測試聚焦在單一難度內的合併行為。
        return {
            diff: [_make_question(text=f"{diff} {t}") for t in texts]
            for diff in DIFFICULTIES
        }

    def test_new_questions_appended_after_existing(self):
        existing = self._bank(["舊題一？", "舊題二？"])
        new = self._bank(["新題一？"])
        merged = merge_question_banks(existing, new)
        for diff in DIFFICULTIES:
            self.assertEqual(
                [q["q"] for q in merged[diff]],
                [f"{diff} 舊題一？", f"{diff} 舊題二？", f"{diff} 新題一？"],
            )

    def test_duplicate_question_text_kept_once(self):
        existing = self._bank(["同一題？"])
        new = self._bank(["同一題？", "新題？"])
        merged = merge_question_banks(existing, new)
        for diff in DIFFICULTIES:
            self.assertEqual(
                [q["q"] for q in merged[diff]],
                [f"{diff} 同一題？", f"{diff} 新題？"],
            )

    def test_dedupe_ignores_whitespace_differences(self):
        existing = self._bank(["1 + 1 = ?"])
        new = self._bank(["1+1=?"])
        merged = merge_question_banks(existing, new)
        for diff in DIFFICULTIES:
            self.assertEqual(len(merged[diff]), 1)

    def test_dedupe_ignores_fullwidth_and_punctuation_variants(self):
        existing = self._bank(["1＋1＝？"])
        new = self._bank(["1+1=?"])
        merged = merge_question_banks(existing, new)
        for diff in DIFFICULTIES:
            self.assertEqual(len(merged[diff]), 1)

    def test_cross_difficulty_dedup_keeps_harder_tier(self):
        existing = {
            diff: [_make_question(text=f"{diff} 專屬題？")] for diff in DIFFICULTIES
        }
        existing["hard"].append(_make_question(text="重複題？"))
        existing["easy"].append(_make_question(text="重複題？"))
        merged = merge_question_banks(existing, {})
        self.assertIn("重複題？", [q["q"] for q in merged["hard"]])
        self.assertNotIn("重複題？", [q["q"] for q in merged["easy"]])

    def test_cap_drops_oldest_questions(self):
        existing = self._bank([f"舊題 {i}？" for i in range(MAX_PER_DIFFICULTY)])
        # 既有 300 題全為「計算」已超過 TYPE_CAP，新題須用未達配額的題型
        # 才能觀察 MAX_PER_DIFFICULTY 的淘汰行為。
        new = self._bank(["新題？"])
        for diff in DIFFICULTIES:
            new[diff][0]["type"] = "邏輯"
        merged = merge_question_banks(existing, new)
        for diff in DIFFICULTIES:
            self.assertEqual(len(merged[diff]), MAX_PER_DIFFICULTY)
            self.assertEqual(merged[diff][-1]["q"], f"{diff} 新題？")
            self.assertEqual(merged[diff][0]["q"], f"{diff} 舊題 1？")

    def test_missing_or_invalid_existing_bank_tolerated(self):
        new = _make_valid_data()
        self.assertEqual(merge_question_banks({}, new), new)
        merged = merge_question_banks({"hard": "not-a-list"}, new)
        self.assertEqual(merged, new)

    def test_merge_skips_new_question_with_duplicate_options(self):
        existing = self._bank(["舊題？"])
        new = self._bank(["新題？"])
        for diff in DIFFICULTIES:
            new[diff][0]["opts"] = ["A", "A", "C", "D"]
        merged = merge_question_banks(existing, new)
        for diff in DIFFICULTIES:
            self.assertEqual([q["q"] for q in merged[diff]], [f"{diff} 舊題？"])

    def test_type_quota_skips_new_question_of_capped_type(self):
        existing = {diff: [] for diff in DIFFICULTIES}
        existing["hard"] = [
            _make_question(text=f"計算題 {i}？") for i in range(TYPE_CAP)
        ]
        other = _make_question(text="新邏輯題？")
        other["type"] = "邏輯"
        new = {diff: [] for diff in DIFFICULTIES}
        new["hard"] = [_make_question(text="新計算題？"), other]
        merged = merge_question_banks(existing, new)
        texts = [q["q"] for q in merged["hard"]]
        self.assertNotIn("新計算題？", texts, "已達 TYPE_CAP 的題型新題應被跳過")
        self.assertIn("新邏輯題？", texts, "未達配額的題型新題應保留")

    def test_type_quota_never_drops_existing_questions(self):
        existing = {diff: [] for diff in DIFFICULTIES}
        existing["hard"] = [
            _make_question(text=f"計算題 {i}？") for i in range(TYPE_CAP + 10)
        ]
        merged = merge_question_banks(existing, {})
        self.assertEqual(len(merged["hard"]), TYPE_CAP + 10)

    def test_merged_bank_passes_validation(self):
        merged = merge_question_banks(_make_valid_data(), self._bank(["另一題？"]))
        self.assertTrue(validate_questions(merged))


class TestRebalance(unittest.TestCase):
    def test_apply_type_cap_keeps_oldest_within_cap(self):
        from rebalance_questions import apply_type_cap

        qs = [_make_question(text=f"計算 {i}？") for i in range(5)]
        other = _make_question(text="邏輯題？")
        other["type"] = "邏輯"
        qs.append(other)
        capped = apply_type_cap(qs, cap=3)
        self.assertEqual(
            [q["q"] for q in capped], ["計算 0？", "計算 1？", "計算 2？", "邏輯題？"]
        )

    def test_refill_fills_rarest_type_first(self):
        from rebalance_questions import refill

        existing = [_make_question(text=f"計算 {i}？") for i in range(3)]
        logic = _make_question(text="邏輯候選？")
        logic["type"] = "邏輯"
        calc = _make_question(text="計算候選？")
        candidates = [calc, logic]
        out = refill(existing, candidates, 4, set())
        self.assertEqual(out[-1]["q"], "邏輯候選？", "數量最少的題型應優先補")

    def test_refill_skips_candidates_already_seen(self):
        from rebalance_questions import refill

        candidate = _make_question(text="重複候選？")
        seen = {"重複候選?"}  # normalize 後全形問號折疊為半形
        out = refill([], [candidate], 1, seen)
        self.assertEqual(out, [], "已出現過的候選題不可再補入")

    def test_refill_respects_type_cap(self):
        from rebalance_questions import refill

        existing = [_make_question(text=f"計算 {i}？") for i in range(3)]
        candidates = [_make_question(text="計算候選？")]
        out = refill(existing, candidates, 4, set(), cap=3)
        self.assertEqual(len(out), 3, "候選題型已達上限時不可補入")

    def test_cross_difficulty_dedup_keeps_first_difficulty(self):
        from rebalance_questions import apply_cross_difficulty_dedup

        bank = {diff: [_make_question(text=f"{diff} 題？")] for diff in DIFFICULTIES}
        bank["hard"].append(_make_question(text="重複題？"))
        bank["easy"].append(_make_question(text="重複題？"))
        deduped, seen = apply_cross_difficulty_dedup(bank)
        self.assertIn("重複題？", [q["q"] for q in deduped["hard"]])
        self.assertNotIn("重複題？", [q["q"] for q in deduped["easy"]])
        self.assertIn(normalize_question_text("重複題？"), seen)

    def test_extra_generators_deterministic(self):
        import random

        import seed_questions

        try:
            seed_questions.set_rng(random.Random(1))
            first = seed_questions.gen_extra_hard()
            seed_questions.set_rng(random.Random(1))
            second = seed_questions.gen_extra_hard()
            self.assertEqual(first, second)
            self.assertTrue(first, "產生器不可回傳空清單")
        finally:
            seed_questions.set_rng(random.Random(20260612))


if __name__ == "__main__":
    unittest.main()
