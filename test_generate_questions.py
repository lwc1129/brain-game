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
    MIN_PER_DIFFICULTY,
    parse_response_text,
    validate_questions,
)


def _make_question(answer="A"):
    return {"type": "計算", "q": "1 + 1 = ?", "a": answer, "opts": ["A", "B", "C", "D"]}


def _make_valid_data():
    data = {}
    for diff in DIFFICULTIES:
        data[diff] = [_make_question() for _ in range(MIN_PER_DIFFICULTY)]
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


if __name__ == "__main__":
    unittest.main()
