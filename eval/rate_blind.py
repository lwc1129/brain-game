"""CLI helper: rate a blind pack using Issue #37 rubric (agent/human assist).

Reads blind/pack.json only (does not open key.json) so rating stays blind.
Writes ratings.json for unblind_report.py.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from eval.rubric import TIER_TO_BAND, verdict_from_bands  # noqa: E402

# Heuristic cues used only as a starting point for agent-assisted rating.
# Final band still follows Issue #37 rules documented in RUBRIC.txt.
_INTUITIVE_PATTERNS = [
    re.compile(r"最愛吃"),
    re.compile(r"有幾個輪子"),
    re.compile(r"吉祥話"),
    re.compile(r"一年有幾個季節"),
    re.compile(r"人體正常體溫"),
    re.compile(r"會不會汪汪叫"),
]


def estimate_band(item: dict) -> tuple[int, str, bool]:
    """Best-effort band estimate for blind rating assistance.

    Returns (band, reason, quality_issue).
    This is deterministic rule-of-thumb scoring for reproducible evals when
    full manual rating is impractical; it mirrors Issue #37 INT / load cues.
    """
    q = str(item.get("q") or "")
    qtype = str(item.get("type") or "")
    claimed = item.get("difficulty")
    quality_issue = False
    reason_parts = []

    # Degenerate constant / trivial sequences
    if re.search(r"(\d+)\s*,\s*\1\s*,\s*\1\s*,\s*\1", q):
        quality_issue = True
        reason_parts.append("常數數列退化題")

    # INT override: pure common-sense / instant recall
    if qtype == "常識" or any(p.search(q) for p in _INTUITIVE_PATTERNS):
        # Memory list questions are not INT even if tagged 常識 incorrectly
        if "記住順序" not in q:
            return 0, "INT 直覺秒答／常識回憶", quality_issue

    # Memory load by list length
    if "記住順序" in q or qtype == "記憶":
        # Count items between ： and ， patterns
        m = re.search(r"記住順序[：:](.+?)[，,]第", q)
        if m:
            items = [x for x in re.split(r"[、,，]", m.group(1)) if x.strip()]
            n = len(items)
            if n >= 7:
                return 3, f"記憶 WM≥7（{n}項）", quality_issue
            if n == 6:
                return 2, f"記憶 WM=6（{n}項）", quality_issue
            if n == 5:
                return 1, f"記憶 WM=5（{n}項）", quality_issue
            return 0, f"記憶 WM≤4（{n}項）", quality_issue

    # Arithmetic complexity cues
    if qtype == "計算" or re.search(r"[＋+\-−×*÷/]", q):
        if re.search(r"[×*].*[＋+\-−]|[＋+\-−].*[×*]|％|%|共有幾", q):
            return 3, "多步混合計算 C=3", quality_issue
        if re.search(r"\d{2}\s*[×*]\s*\d", q) or "買" in q and "共" in q:
            return 2, "兩位數×個位／情境乘法 C=2–3→medium", quality_issue
        if re.search(r"\d{2}\s*[＋+\-−]\s*\d{2}", q) or "×" in q or "*" in q:
            return 1, "兩位數加減或九九 C=2→easy", quality_issue
        return 0, "個位數加減 C≤1→super_easy", quality_issue

    # Sequence patterns
    if qtype == "數列" or "數列" in q:
        nums = [int(x) for x in re.findall(r"-?\d+", q)]
        if len(nums) >= 4:
            diffs = [nums[i + 1] - nums[i] for i in range(len(nums) - 1)]
            if len(set(diffs)) == 1 and abs(diffs[0]) == 1:
                return 0, "連續整數數列 P=1", quality_issue
            if len(set(diffs)) == 1:
                return 1 if abs(diffs[0]) <= 5 else 2, "等差數列", quality_issue
            # non-constant first differences → harder
            return 3, "非等差模式 P=3", quality_issue
        return 1, "數列（資訊不足，保守 easy）", quality_issue

    # Multi-step date reasoning
    if any(k in q for k in ("前天", "大後天", "天後", "天前")):
        return 2, "多步日期推理 R≥1 S≥2", quality_issue
    if any(k in q for k in ("昨天", "明天", "下一個月")):
        return 1, "單步日期推理", quality_issue

    # Logic with liar puzzles / multi-condition
    if qtype == "邏輯" and any(k in q for k in ("說謊", "真話", "如果", "那麼")):
        return 3, "條件／真假邏輯 R≥2", quality_issue
    if qtype == "邏輯" and "不是" in q:
        return 1, "odd-one-out 分類", quality_issue

    # Default: stay near claimed tier but slightly easier bias awareness
    # Prefer band = claimed for ambiguous items lacking hard cues.
    band = TIER_TO_BAND.get(claimed, 1)
    # Without hard-load cues, hard/medium often collapse easier in #37 study.
    if claimed == "hard" and not reason_parts:
        band = 1
        reason_parts.append("hard 題缺少 S≥3/R≥2/C=3/P=3/WM≥7 線索 → 偏易")
    elif claimed == "medium" and not reason_parts:
        band = 1
        reason_parts.append("medium 題缺少兩步／WM6／模式推導線索 → 偏易")
    reason = "；".join(reason_parts) if reason_parts else f"依題型預設接近 claimed={claimed}"
    return band, reason, quality_issue


def rate_pack(pack_path: Path) -> list[dict]:
    data = json.loads(pack_path.read_text(encoding="utf-8"))
    items = data["items"] if isinstance(data, dict) else data
    ratings = []
    for item in items:
        band, reason, qi = estimate_band(item)
        verdict = verdict_from_bands(item["difficulty"], band)
        ratings.append(
            {
                "id": item["id"],
                "difficulty": item["difficulty"],
                "rated_band": band,
                "verdict": verdict,
                "quality_issue": qi,
                "reason": reason,
            }
        )
    return ratings


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description="Blind-rate pack.json without reading key")
    p.add_argument("--pack", required=True, help="Path to blind/pack.json")
    p.add_argument("--out", required=True, help="Output ratings.json")
    args = p.parse_args(argv)

    pack_path = Path(args.pack)
    # Hard guard: refuse if caller accidentally points at key.json
    if pack_path.name == "key.json":
        raise SystemExit("拒絕：不可對 key.json 評分（會破壞 blind）")

    ratings = rate_pack(pack_path)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps({"ratings": ratings, "method": "rubric_heuristic_v1"}, ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"ok": True, "n": len(ratings), "out": str(out)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
