"""Issue #37 difficulty rubric constants for blind rating guidance.

QUALITY_ISSUE is tracked independently and never merged into FIT/TOO_* verdicts.
This module does not gate production validation.
"""

from __future__ import annotations

# Claimed difficulty → band index (Issue #37 §3.2)
TIER_TO_BAND = {
    "super_easy": 0,
    "easy": 1,
    "medium": 2,
    "hard": 3,
}

BAND_TO_TIER = {v: k for k, v in TIER_TO_BAND.items()}

VERDICTS = ("FIT", "TOO_EASY", "TOO_HARD", "WRONG_TIER")

RUBRIC_SUMMARY = """
Issue #37 Difficulty Rubric（評分前請先讀）

維度（各 0–3）：
- S 解題步驟：0 直接辨識／1 單步／2 兩步／3 三步以上
- WM 工作記憶：0 ≤2 項／1 =3–4／2 =5–6／3 ≥7
- R 推理鏈：0 無／1 單一推論／2 兩段／3 多段或反證
- C 計算：0 無／1 個位加減／2 兩位加減進位或九九／3 多步混合乘除百分比
- P 模式：0 無／1 連續整數／明顯等差／2 需推導間距／3 非等差
- D 干擾：0 無／1 選項近似／2 題幹含無關資訊／3 兩者
- INT：若直覺秒答（無步驟、無推理、純常識回憶）→ band 直接為 0（super_easy）

Band：
- 0 super_easy：S≤1、WM≤4、R=0、C≤1、P≤1
- 1 easy：S=1–2、WM≤5、R≤1、C≤2、P≤1
- 2 medium：S=2–3、WM≈6、R=1–2、C=2–3、P=2
- 3 hard：S≥3 或 R≥2 或 C=3 或 P=3 或 WM≥7（至少一項）

Verdict（相對 claimed difficulty）：
- FIT：band == tier
- TOO_EASY：band == tier − 1
- TOO_HARD：band == tier + 1
- WRONG_TIER：|band − tier| ≥ 2
- QUALITY_ISSUE：獨立欄位（退化題／語意近重複／雙正解／邏輯無解等），不取代上列 verdict
""".strip()


def verdict_from_bands(claimed_tier: str, rated_band: int) -> str:
    """Map claimed tier + rated band → FIT / TOO_EASY / TOO_HARD / WRONG_TIER."""
    if claimed_tier not in TIER_TO_BAND:
        raise ValueError(f"未知 difficulty：{claimed_tier}")
    if rated_band not in BAND_TO_TIER:
        raise ValueError(f"rated_band 必須是 0–3，收到：{rated_band}")
    claimed = TIER_TO_BAND[claimed_tier]
    delta = rated_band - claimed
    if delta == 0:
        return "FIT"
    if delta == -1:
        return "TOO_EASY"
    if delta == 1:
        return "TOO_HARD"
    return "WRONG_TIER"
