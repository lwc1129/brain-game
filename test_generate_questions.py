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
    merge_question_banks,
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


class TestMergeQuestionBanks(unittest.TestCase):
    def _bank(self, texts):
        return {diff: [_make_question(text=t) for t in texts] for diff in DIFFICULTIES}

    def test_new_questions_appended_after_existing(self):
        existing = self._bank(["舊題一？", "舊題二？"])
        new = self._bank(["新題一？"])
        merged = merge_question_banks(existing, new)
        for diff in DIFFICULTIES:
            self.assertEqual(
                [q["q"] for q in merged[diff]], ["舊題一？", "舊題二？", "新題一？"]
            )

    def test_duplicate_question_text_kept_once(self):
        existing = self._bank(["同一題？"])
        new = self._bank(["同一題？", "新題？"])
        merged = merge_question_banks(existing, new)
        for diff in DIFFICULTIES:
            self.assertEqual([q["q"] for q in merged[diff]], ["同一題？", "新題？"])

    def test_dedupe_ignores_whitespace_differences(self):
        existing = self._bank(["1 + 1 = ?"])
        new = self._bank(["1+1=?"])
        merged = merge_question_banks(existing, new)
        for diff in DIFFICULTIES:
            self.assertEqual(len(merged[diff]), 1)

    def test_cap_drops_oldest_questions(self):
        existing = self._bank([f"舊題 {i}？" for i in range(MAX_PER_DIFFICULTY)])
        new = self._bank(["新題？"])
        merged = merge_question_banks(existing, new)
        for diff in DIFFICULTIES:
            self.assertEqual(len(merged[diff]), MAX_PER_DIFFICULTY)
            self.assertEqual(merged[diff][-1]["q"], "新題？")
            self.assertEqual(merged[diff][0]["q"], "舊題 1？")

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
            self.assertEqual([q["q"] for q in merged[diff]], ["舊題？"])

    def test_merged_bank_passes_validation(self):
        merged = merge_question_banks(_make_valid_data(), self._bank(["另一題？"]))
        self.assertTrue(validate_questions(merged))


if __name__ == "__main__":
    unittest.main()
