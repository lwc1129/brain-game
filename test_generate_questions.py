"""generate_questions.py 的格式驗證單元測試。

依 BDD Specs 撰寫（TDD 第一步），涵蓋：
- 合法格式 → 通過驗證，回傳 True
- 缺少必要欄位（如 a / answer）→ 驗證失敗，raise Exception
- 非 JSON 字串 → 驗證失敗，raise Exception
- 題目數不足（0 題）→ 驗證失敗，raise Exception

執行：python -m unittest test_generate_questions -v
"""

import copy
import inspect
import io
import json
import sys
import types as stdlib_types
import unittest
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

from generate_questions import (
    DIFFICULTIES,
    MAX_PER_DIFFICULTY,
    MIN_PER_DIFFICULTY,
    MIN_VALID_NEW_QUESTIONS,
    MODEL_NAME,
    TYPE_CAP,
    build_prompt,
    call_gemini,
    compute_type_counts,
    filter_valid_generated_questions,
    merge_question_banks,
    normalize_question_text,
    parse_response_text,
    process_generated_questions,
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


class TestPartialAcceptance(unittest.TestCase):
    """Issue #35：新生成題目逐題過濾，單一壞題不拖垮整批。"""

    def _bank_with_n(self, n, prefix="題"):
        return {
            diff: [
                _make_question(text=f"{diff} {prefix} {i}？") for i in range(n)
            ]
            for diff in DIFFICULTIES
        }

    def test_single_bad_question_does_not_reject_batch(self):
        data = self._bank_with_n(MIN_PER_DIFFICULTY, prefix="好題")
        data["hard"][1] = {
            "type": "計算",
            "q": "hard 壞題？",
            "a": "Z",
            "opts": ["A", "B", "C", "D"],
        }
        filtered, exclusions = filter_valid_generated_questions(data)
        self.assertEqual(len(exclusions), 1)
        self.assertIn("正確答案", exclusions[0]["reason"])
        self.assertEqual(exclusions[0]["difficulty"], "hard")
        self.assertEqual(exclusions[0]["index"], 1)
        hard_texts = [q["q"] for q in filtered["hard"]]
        self.assertNotIn("hard 壞題？", hard_texts)
        self.assertEqual(len(filtered["hard"]), MIN_PER_DIFFICULTY - 1)
        for diff in ("medium", "easy", "super_easy"):
            self.assertEqual(len(filtered[diff]), MIN_PER_DIFFICULTY)

    def test_all_bad_questions_fail_threshold(self):
        data = {
            diff: [
                {
                    "type": "計算",
                    "q": f"{diff} 壞 {i}？",
                    "a": "Z",
                    "opts": ["A", "B", "C", "D"],
                }
                for i in range(MIN_PER_DIFFICULTY)
            ]
            for diff in DIFFICULTIES
        }
        with self.assertRaises(ValueError) as ctx:
            process_generated_questions(_make_valid_data(), data)
        self.assertIn("最低有效題數", str(ctx.exception))

    def test_below_min_valid_new_questions_fails(self):
        # 僅留下剛好低於門檻的有效題，其餘皆壞題。
        self.assertGreater(MIN_VALID_NEW_QUESTIONS, 1)
        data = {
            diff: [
                {
                    "type": "計算",
                    "q": f"{diff} 壞 {i}？",
                    "a": "Z",
                    "opts": ["A", "B", "C", "D"],
                }
                for i in range(5)
            ]
            for diff in DIFFICULTIES
        }
        # 只放 MIN_VALID_NEW_QUESTIONS - 1 題合法題，集中在 hard。
        keep = MIN_VALID_NEW_QUESTIONS - 1
        data["hard"] = [
            _make_question(text=f"hard 好題 {i}？") for i in range(keep)
        ]
        with self.assertRaises(ValueError) as ctx:
            process_generated_questions(_make_valid_data(), data)
        msg = str(ctx.exception)
        self.assertIn("最低有效題數", msg)
        self.assertIn(str(MIN_VALID_NEW_QUESTIONS), msg)

    def test_merged_bank_invalid_still_fails(self):
        # 既有題庫各難度不足；新題通過過濾但合併後仍低於 MIN_PER_DIFFICULTY。
        existing = {diff: [] for diff in DIFFICULTIES}
        # 湊滿門檻總數，但集中在單一難度 → 其他難度合併後仍 0 題。
        n = max(MIN_VALID_NEW_QUESTIONS, MIN_PER_DIFFICULTY)
        new = {diff: [] for diff in DIFFICULTIES}
        new["hard"] = [_make_question(text=f"hard only {i}？") for i in range(n)]
        with self.assertRaises(ValueError) as ctx:
            process_generated_questions(existing, new)
        self.assertIn("題目數不足", str(ctx.exception))

    def test_valid_questions_proceed_to_merge(self):
        existing = self._bank_with_n(MIN_PER_DIFFICULTY, prefix="舊")
        new = self._bank_with_n(MIN_PER_DIFFICULTY, prefix="新")
        # 夾一題壞題，其餘應進入 merge。
        new["easy"].append(
            {
                "type": "計算",
                "q": "easy 壞題？",
                "a": "Z",
                "opts": ["A", "B", "C", "D"],
            }
        )
        merged, accepted_count = process_generated_questions(existing, new)
        self.assertTrue(validate_questions(merged))
        self.assertEqual(accepted_count, MIN_PER_DIFFICULTY * len(DIFFICULTIES))
        for diff in DIFFICULTIES:
            texts = [q["q"] for q in merged[diff]]
            self.assertIn(f"{diff} 舊 0？", texts)
            self.assertIn(f"{diff} 新 0？", texts)
        self.assertNotIn("easy 壞題？", [q["q"] for q in merged["easy"]])

    def test_filter_records_exclusion_reasons(self):
        data = self._bank_with_n(MIN_PER_DIFFICULTY)
        data["medium"][0] = "not-a-dict"
        del data["medium"][1]["a"]
        data["medium"][2]["opts"] = ["A", "A", "C", "D"]
        _, exclusions = filter_valid_generated_questions(data)
        reasons = " ".join(e["reason"] for e in exclusions)
        self.assertGreaterEqual(len(exclusions), 3)
        self.assertIn("不是物件", reasons)
        self.assertIn("缺少必要欄位", reasons)
        self.assertIn("重複選項", reasons)

    def test_min_valid_new_questions_is_named_constant(self):
        self.assertIsInstance(MIN_VALID_NEW_QUESTIONS, int)
        self.assertGreaterEqual(MIN_VALID_NEW_QUESTIONS, 1)

    def test_threshold_failure_emits_structured_error_log(self):
        # Codex P1：門檻失敗須在 raise 前 emit 結構化 error log。
        data = {diff: [] for diff in DIFFICULTIES}
        data["hard"] = [
            _make_question(text=f"hard only {i}？")
            for i in range(MIN_VALID_NEW_QUESTIONS - 1)
        ]
        stderr = io.StringIO()
        with patch("sys.stderr", stderr):
            with self.assertRaises(ValueError) as ctx:
                process_generated_questions(_make_valid_data(), data)
        self.assertIn("最低有效題數", str(ctx.exception))
        error_records = [
            json.loads(line)
            for line in stderr.getvalue().splitlines()
            if line.strip().startswith("{")
        ]
        error_records = [r for r in error_records if r.get("level") == "error"]
        self.assertEqual(len(error_records), 1)
        record = error_records[0]
        self.assertIn("ts", record)
        self.assertIn("msg", record)
        ctx = record["ctx"]
        self.assertEqual(ctx["accepted_count"], MIN_VALID_NEW_QUESTIONS - 1)
        self.assertEqual(ctx["required_count"], MIN_VALID_NEW_QUESTIONS)
        self.assertIn("excluded_count", ctx)

    def test_missing_difficulty_key_is_rejected(self):
        # Codex P2：缺難度 key 不可 default [] 隱藏；present empty list 仍可接受。
        data = self._bank_with_n(MIN_PER_DIFFICULTY, prefix="完整")
        del data["easy"]
        with self.assertRaises(ValueError) as ctx:
            filter_valid_generated_questions(data)
        self.assertIn("缺少必要難度欄位", str(ctx.exception))
        self.assertIn("easy", str(ctx.exception))

        present_empty = self._bank_with_n(MIN_PER_DIFFICULTY, prefix="有空")
        present_empty["easy"] = []
        filtered, exclusions = filter_valid_generated_questions(present_empty)
        self.assertEqual(filtered["easy"], [])
        self.assertEqual(exclusions, [])

    def test_threshold_uses_post_merge_added_count(self):
        # Codex P2：全 duplicate 時 schema 合法數達門檻，但 merge 後新增為 0 → 須失敗。
        existing = self._bank_with_n(MIN_VALID_NEW_QUESTIONS, prefix="既有")
        # 與既有題文完全相同 → merge 後 0 題新增。
        duplicates = self._bank_with_n(MIN_VALID_NEW_QUESTIONS, prefix="既有")
        schema_valid = sum(len(duplicates[d]) for d in DIFFICULTIES)
        self.assertGreaterEqual(schema_valid, MIN_VALID_NEW_QUESTIONS)
        stderr = io.StringIO()
        with patch("sys.stderr", stderr):
            with self.assertRaises(ValueError) as ctx:
                process_generated_questions(existing, duplicates)
        self.assertIn("最低有效題數", str(ctx.exception))
        self.assertIn("實際 0 題", str(ctx.exception))
        error_records = [
            json.loads(line)
            for line in stderr.getvalue().splitlines()
            if line.strip().startswith("{")
        ]
        error_records = [r for r in error_records if r.get("level") == "error"]
        self.assertEqual(error_records[0]["ctx"]["accepted_count"], 0)


@contextmanager
def _stub_google_genai(mock_client_cls=None):
    """注入假 google.genai 模組，讓 call_gemini 在未安裝 SDK 時仍可測。

    unittest.mock.patch('google.genai.Client') 會先真實 import target，
    CI 的 python-tests job 不裝 google-genai，因此改用 sys.modules stub。
    """
    if mock_client_cls is None:
        mock_client_cls = MagicMock(name="Client")

    google_mod = stdlib_types.ModuleType("google")
    genai_mod = stdlib_types.ModuleType("google.genai")
    types_mod = stdlib_types.ModuleType("google.genai.types")

    class GenerateContentConfig:
        def __init__(self, response_mime_type=None, **_kwargs):
            self.response_mime_type = response_mime_type

    types_mod.GenerateContentConfig = GenerateContentConfig
    genai_mod.Client = mock_client_cls
    genai_mod.types = types_mod
    google_mod.genai = genai_mod

    with patch.dict(
        sys.modules,
        {
            "google": google_mod,
            "google.genai": genai_mod,
            "google.genai.types": types_mod,
        },
    ):
        yield mock_client_cls


class TestCallGemini(unittest.TestCase):
    """SDK adapter boundary：mock google.genai，不發真實網路請求。"""

    def _mock_response(self, text):
        part = MagicMock()
        part.text = text
        candidate = MagicMock()
        candidate.content.parts = [part]
        response = MagicMock()
        response.candidates = [candidate]
        return response

    def test_returns_text_via_candidates_path(self):
        with _stub_google_genai() as mock_client_cls:
            mock_client = mock_client_cls.return_value
            mock_client.models.generate_content.return_value = self._mock_response(
                '{"hard":[]}'
            )

            result = call_gemini("test-api-key")

            self.assertEqual(result, '{"hard":[]}')
            mock_client_cls.assert_called_once_with(api_key="test-api-key")
            kwargs = mock_client.models.generate_content.call_args.kwargs
            self.assertEqual(kwargs["model"], MODEL_NAME)
            self.assertEqual(kwargs["contents"], build_prompt(None))
            self.assertEqual(kwargs["config"].response_mime_type, "application/json")

    def test_passes_type_counts_into_prompt(self):
        with _stub_google_genai() as mock_client_cls:
            mock_client = mock_client_cls.return_value
            mock_client.models.generate_content.return_value = self._mock_response("{}")
            type_counts = {d: {"計算": 1} for d in DIFFICULTIES}

            call_gemini("k", type_counts)

            kwargs = mock_client.models.generate_content.call_args.kwargs
            self.assertEqual(kwargs["contents"], build_prompt(type_counts))

    def test_missing_candidates_raises_value_error(self):
        with _stub_google_genai() as mock_client_cls:
            mock_client = mock_client_cls.return_value
            response = MagicMock()
            response.candidates = None
            mock_client.models.generate_content.return_value = response

            with self.assertRaises(ValueError) as ctx:
                call_gemini("k")
            self.assertIn("無法從 Gemini 回應取得內容", str(ctx.exception))

    def test_empty_candidates_raises_value_error(self):
        with _stub_google_genai() as mock_client_cls:
            mock_client = mock_client_cls.return_value
            response = MagicMock()
            response.candidates = []
            mock_client.models.generate_content.return_value = response

            with self.assertRaises(ValueError) as ctx:
                call_gemini("k")
            self.assertIn("無法從 Gemini 回應取得內容", str(ctx.exception))

    def test_source_uses_google_genai_not_deprecated_sdk(self):
        source = inspect.getsource(call_gemini)
        self.assertNotIn("google.generativeai", source)
        self.assertIn("from google import genai", source)
        self.assertIn("genai.Client", source)
        self.assertIn("response_mime_type", source)
        self.assertIn("candidates[0].content.parts[0].text", source)


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

        original_rng = seed_questions.rng
        try:
            seed_questions.set_rng(random.Random(1))
            first = seed_questions.gen_extra_hard()
            seed_questions.set_rng(random.Random(1))
            second = seed_questions.gen_extra_hard()
            self.assertEqual(first, second)
            self.assertTrue(first, "產生器不可回傳空清單")
        finally:
            seed_questions.set_rng(original_rng)


if __name__ == "__main__":
    unittest.main()
