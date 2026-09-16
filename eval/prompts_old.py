"""Frozen pre-calibration prompt for Issue #46 before/after evaluation.

This is an exact snapshot of generate_questions.build_prompt() as of
main @ 8331223 (before Issue #46 calibration). Do not edit to match the
calibrated prompt — the point of this module is a stable baseline.
"""

from __future__ import annotations

import json
import os
import sys

# Allow importing generate_questions constants without circular prompt deps.
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from generate_questions import ALLOWED_TYPES, DIFFICULTIES, MIN_PER_DIFFICULTY


def build_old_prompt(type_counts=None):
    """Reproduce the pre-calibration weekly-generation prompt."""
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

    priority_part = ""
    if type_counts:
        totals = {}
        for diff in DIFFICULTIES:
            per_type = type_counts.get(diff) or {}
            for qtype, n in per_type.items():
                if qtype in ALLOWED_TYPES and isinstance(n, int):
                    totals[qtype] = totals.get(qtype, 0) + n
        counts_text = "、".join(f"{t} {totals.get(t, 0)} 題" for t in ALLOWED_TYPES)
        rarest = sorted(ALLOWED_TYPES, key=lambda t: totals.get(t, 0))[:3]
        priority_part = (
            f"目前題庫各題型題數：{counts_text}。\n"
            f"請優先產生數量最少的題型：{'、'.join(rarest)}。\n\n"
        )

    return (
        "你是一位繁體中文的認知訓練題庫設計師，服務對象為銀髮族。\n"
        "請產生一份適合每日腦力挑戰的題庫，主題可包含："
        f"{'、'.join(ALLOWED_TYPES)}。\n\n"
        + priority_part
        + "嚴格要求（務必遵守）：\n"
        f"1. 回傳「純 JSON」，不要有任何說明文字或 markdown 標記。\n"
        f"2. 最外層為物件，必須包含這四個 key：{', '.join(DIFFICULTIES)}。\n"
        "   - hard：困難；medium：中等；easy：簡單；super_easy：超簡單。\n"
        f"3. 每個難度至少 {MIN_PER_DIFFICULTY + 5} 題（題數越多越好，請盡量產生 8~10 題）。\n"
        "4. 每一題為物件，必須包含欄位：\n"
        "   - type：題目類型（字串，如「計算」「邏輯」「常識」）\n"
        "   - q：題目敘述（字串，繁體中文，結尾用全形問號）\n"
        "   - a：正確答案（字串）\n"
        "   - opts：4 個選項的陣列（字串陣列），互不相同，且 a 必須是 opts 其中之一\n"
        "5. 難度需明顯區隔：super_easy 給認知退化者，hard 需要較多思考。\n"
        "6. 全部使用繁體中文。\n\n"
        "回傳格式範例（僅示意結構，內容請自行產生）：\n"
        + json.dumps(schema_example, ensure_ascii=False, indent=2)
        + "\n\n只回傳純JSON物件，不要有任何其他文字或markdown。"
    )
