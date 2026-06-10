#!/usr/bin/env python3
"""使用 Gemini API 自動擴充 brain-game 的每週題庫。

由 GitHub Actions 每週排程觸發。流程：
1. 從環境變數讀取 GEMINI_API_KEY（不 hardcode）。
2. 呼叫 Gemini API，要求回傳嚴格 JSON 格式的新題目。
3. 解析並驗證回傳內容是否符合 QB schema。
4. 與既有 questions.json「合併」：以題目文字去重、新題附加在後、
   每難度題數達上限時淘汰最舊的題目。題庫因此每週成長而非被覆蓋，
   搭配前端的近期出題排除機制，降低熟客遇到重複題目的頻率。
5. 驗證通過才寫入 questions.json；任何失敗以非零 exit code 中止。

QB schema（與 index.html 內現有 QB 物件完全一致）：
{
  "hard":       [{"type": str, "q": str, "a": str, "opts": [str, ...]}, ...],
  "medium":     [...],
  "easy":       [...],
  "super_easy": [...]
}
規則：每個難度至少 MIN_PER_DIFFICULTY 題；每題 a 必須出現在 opts 中。
"""

import json
import os
import sys

# QB schema 的四個難度層級，順序與 index.html 一致。
DIFFICULTIES = ["hard", "medium", "easy", "super_easy"]

# 每個難度的最低題目數。對齊前端 js/logic.js 的 pickQuestions()：
# 每次抽 3 題，故每個難度至少需 3 題才能保證遊戲正常運作。
MIN_PER_DIFFICULTY = 3

# 合併後每個難度的題數上限，超過時淘汰最舊的題目。
MAX_PER_DIFFICULTY = 200

# 每題必要欄位。
REQUIRED_QUESTION_FIELDS = ["type", "q", "a", "opts"]

OUTPUT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "questions.json")

MODEL_NAME = "gemini-1.5-flash"


def build_prompt():
    """組出要求 Gemini 回傳嚴格 JSON 題庫的 prompt。"""
    schema_example = {
        "hard": [
            {
                "type": "邏輯",
                "q": "範例題目敘述？",
                "a": "正確答案",
                "opts": ["正確答案", "干擾選項1", "干擾選項2", "干擾選項3"],
            }
        ],
        "medium": [],
        "easy": [],
        "super_easy": [],
    }
    return (
        "你是一位繁體中文的認知訓練題庫設計師，服務對象為銀髮族。\n"
        "請產生一份適合每日腦力挑戰的題庫，主題可包含：計算、邏輯、數列、"
        "推理、語言、記憶、常識。\n\n"
        "嚴格要求（務必遵守）：\n"
        f"1. 回傳「純 JSON」，不要有任何說明文字或 markdown 標記。\n"
        f"2. 最外層為物件，必須包含這四個 key：{', '.join(DIFFICULTIES)}。\n"
        "   - hard：困難；medium：中等；easy：簡單；super_easy：超簡單。\n"
        f"3. 每個難度至少 {MIN_PER_DIFFICULTY + 5} 題（題數越多越好，請盡量產生 8~10 題）。\n"
        "4. 每一題為物件，必須包含欄位：\n"
        "   - type：題目類型（字串，如「計算」「邏輯」「常識」）\n"
        "   - q：題目敘述（字串，繁體中文，結尾用全形問號）\n"
        "   - a：正確答案（字串）\n"
        "   - opts：4 個選項的陣列（字串陣列），且 a 必須是 opts 其中之一\n"
        "5. 難度需明顯區隔：super_easy 給認知退化者，hard 需要較多思考。\n"
        "6. 全部使用繁體中文。\n\n"
        "回傳格式範例（僅示意結構，內容請自行產生）：\n"
        + json.dumps(schema_example, ensure_ascii=False, indent=2)
    )


def parse_response_text(text):
    """將 Gemini 回傳文字解析為 dict。

    會容忍被 ```json ... ``` 或 ``` ... ``` 包覆的情況。
    無法解析為合法 JSON 時 raise ValueError。
    """
    if text is None:
        raise ValueError("Gemini 回傳內容為空（None）")

    cleaned = text.strip()
    if not cleaned:
        raise ValueError("Gemini 回傳內容為空字串")

    # 去除 markdown code fence。
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        # 移除第一行的 ``` 或 ```json
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        # 移除結尾的 ```
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()

    try:
        return json.loads(cleaned)
    except (json.JSONDecodeError, TypeError) as exc:
        raise ValueError(f"無法解析 Gemini 回傳為合法 JSON：{exc}") from exc


def validate_questions(data):
    """驗證題庫結構是否符合 QB schema。

    通過回傳 True；任何不符合處 raise ValueError。
    """
    if not isinstance(data, dict):
        raise ValueError("題庫最外層必須是物件（dict）")

    for diff in DIFFICULTIES:
        if diff not in data:
            raise ValueError(f"題庫缺少必要難度欄位：{diff}")

        questions = data[diff]
        if not isinstance(questions, list):
            raise ValueError(f"難度 {diff} 的值必須是陣列（list）")

        if len(questions) < MIN_PER_DIFFICULTY:
            raise ValueError(
                f"難度 {diff} 題目數不足：需要至少 {MIN_PER_DIFFICULTY} 題，"
                f"實際 {len(questions)} 題"
            )

        for idx, q in enumerate(questions):
            if not isinstance(q, dict):
                raise ValueError(f"難度 {diff} 第 {idx} 題不是物件（dict）")

            for field in REQUIRED_QUESTION_FIELDS:
                if field not in q:
                    raise ValueError(
                        f"難度 {diff} 第 {idx} 題缺少必要欄位：{field}"
                    )

            if not isinstance(q["type"], str) or not q["type"].strip():
                raise ValueError(f"難度 {diff} 第 {idx} 題的 type 必須是非空字串")
            if not isinstance(q["q"], str) or not q["q"].strip():
                raise ValueError(f"難度 {diff} 第 {idx} 題的 q 必須是非空字串")
            if not isinstance(q["a"], str) or not q["a"].strip():
                raise ValueError(f"難度 {diff} 第 {idx} 題的 a 必須是非空字串")

            opts = q["opts"]
            if not isinstance(opts, list) or len(opts) < 2:
                raise ValueError(
                    f"難度 {diff} 第 {idx} 題的 opts 必須是至少 2 個選項的陣列"
                )
            if not all(isinstance(o, str) for o in opts):
                raise ValueError(f"難度 {diff} 第 {idx} 題的 opts 必須全部為字串")
            if q["a"] not in opts:
                raise ValueError(
                    f"難度 {diff} 第 {idx} 題的正確答案 a 不在 opts 選項中"
                )

    return True


def normalize_question_text(text):
    """去除空白後的題目文字，作為去重 key。"""
    return "".join(str(text).split())


def load_existing_bank(path):
    """讀取既有題庫。檔案不存在、無法解析或結構不符時回傳空題庫。

    既有題庫損壞不應讓整次更新失敗（新題庫仍會經過完整驗證），
    因此這裡容錯處理、僅輸出警告。
    """
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        print(f"警告：無法讀取既有題庫，視為空題庫：{exc}", file=sys.stderr)
        return {}
    if not isinstance(data, dict):
        print("警告：既有題庫結構不符，視為空題庫", file=sys.stderr)
        return {}
    return data


def merge_question_banks(existing, new):
    """合併既有題庫與新題庫。

    規則：
    - 以去除空白後的題目文字（q）去重，既有題目優先保留。
    - 新題附加在既有題目之後。
    - 每難度超過 MAX_PER_DIFFICULTY 時，淘汰最舊（最前面）的題目。
    """
    merged = {}
    for diff in DIFFICULTIES:
        old_qs = existing.get(diff) if isinstance(existing.get(diff), list) else []
        new_qs = new.get(diff, [])
        seen = set()
        combined = []
        for q in list(old_qs) + list(new_qs):
            if not isinstance(q, dict):
                continue
            key = normalize_question_text(q.get("q", ""))
            if not key or key in seen:
                continue
            seen.add(key)
            combined.append(q)
        merged[diff] = combined[-MAX_PER_DIFFICULTY:]
    return merged


def call_gemini(api_key):
    """呼叫 Gemini API，回傳文字內容。

    依規格使用回傳路徑 response.candidates[0].content.parts[0].text。
    """
    import google.generativeai as genai

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(MODEL_NAME)
    response = model.generate_content(
        build_prompt(),
        generation_config={"response_mime_type": "application/json"},
    )

    try:
        return response.candidates[0].content.parts[0].text
    except (AttributeError, IndexError, KeyError) as exc:
        raise ValueError(f"無法從 Gemini 回應取得內容：{exc}") from exc


def main():
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("錯誤：未設定環境變數 GEMINI_API_KEY", file=sys.stderr)
        sys.exit(1)

    try:
        raw_text = call_gemini(api_key)
        new_data = parse_response_text(raw_text)
        validate_questions(new_data)
        merged = merge_question_banks(load_existing_bank(OUTPUT_PATH), new_data)
        validate_questions(merged)
    except Exception as exc:  # noqa: BLE001 - 任何失敗都需明確中止
        print(f"題庫產生失敗，不更新 questions.json：{exc}", file=sys.stderr)
        sys.exit(1)

    try:
        with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
            json.dump(merged, f, ensure_ascii=False, indent=2)
            f.write("\n")
    except OSError as exc:
        print(f"寫入 questions.json 失敗：{exc}", file=sys.stderr)
        sys.exit(1)

    new_total = sum(len(new_data[d]) for d in DIFFICULTIES)
    total = sum(len(merged[d]) for d in DIFFICULTIES)
    print(f"已成功更新 questions.json：本次新增候選 {new_total} 題，合併後共 {total} 題。")


if __name__ == "__main__":
    main()
