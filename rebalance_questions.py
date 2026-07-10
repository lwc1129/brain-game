#!/usr/bin/env python3
"""一次性題庫重平衡腳本：修正 questions.json 的題型失衡與跨難度重複。

背景：既有題庫約 49% 為「計算」題，且有 13 題同時出現在兩個難度。
本腳本以固定亂數種子執行，重跑可 byte-for-byte 重現，流程：
1. 跨難度去重（同一題文保留在較難的難度，與 merge_question_banks 一致）。
2. 每難度套用 TYPE_CAP：單一題型超過上限時，保留最舊（最前面）的題目。
3. 以 seed_questions 的補題產生器把每難度補回 MAX_PER_DIFFICULTY 題，
   數量最少的題型優先補，且不使任何題型超過 TYPE_CAP。
4. 全部題目通過 check_question_shape 與 validate_questions 後才寫檔。

執行：python rebalance_questions.py
"""

import json
import random
import sys

import seed_questions
from generate_questions import (
    DIFFICULTIES,
    MAX_PER_DIFFICULTY,
    OUTPUT_PATH,
    TYPE_CAP,
    load_existing_bank,
    normalize_question_text,
    validate_questions,
)

# 固定種子讓補題結果可重現（與 seed_questions.py 的種子無關）。
REBALANCE_SEED = 20260707


def apply_cross_difficulty_dedup(bank):
    """跨難度去重：依 DIFFICULTIES 順序（難 → 易），先出現者保留。

    回傳 (去重後題庫, 已使用的正規化題文集合)。
    """
    seen = set()
    result = {}
    for diff in DIFFICULTIES:
        qs = bank.get(diff) if isinstance(bank.get(diff), list) else []
        kept = []
        for q in qs:
            key = normalize_question_text(q.get("q", ""))
            if not key or key in seen:
                continue
            seen.add(key)
            kept.append(q)
        result[diff] = kept
    return result, seen


def apply_type_cap(questions, cap=TYPE_CAP):
    """單一題型超過 cap 時，保留最舊（最前面）的 cap 題，其餘剔除。"""
    counts = {}
    kept = []
    for q in questions:
        qtype = q["type"]
        if counts.get(qtype, 0) >= cap:
            continue
        counts[qtype] = counts.get(qtype, 0) + 1
        kept.append(q)
    return kept


def refill(questions, candidates, target, seen, cap=TYPE_CAP):
    """從 candidates 補題到 target 題：每次補當前數量最少的題型。

    - candidates 依產生順序消耗，與 seen（全域正規化題文集合）去重。
    - 不使任何題型超過 cap。
    - 候選不足時回傳未補滿的結果，由呼叫端判斷失敗。
    """
    by_type = {}
    for q in candidates:
        by_type.setdefault(q["type"], []).append(q)

    counts = {}
    for q in questions:
        counts[q["type"]] = counts.get(q["type"], 0) + 1

    out = list(questions)
    while len(out) < target:
        avail = [t for t, qs in by_type.items() if qs and counts.get(t, 0) < cap]
        if not avail:
            break
        qtype = min(avail, key=lambda t: counts.get(t, 0))
        q = by_type[qtype].pop(0)
        key = normalize_question_text(q["q"])
        if not key or key in seen:
            continue
        seen.add(key)
        counts[qtype] = counts.get(qtype, 0) + 1
        out.append(q)
    return out


def rebalance(bank, candidates_by_diff):
    """純函數版重平衡流程：去重 → 題型上限 → 補題。補不滿時 raise ValueError。"""
    deduped, seen = apply_cross_difficulty_dedup(bank)
    result = {}
    for diff in DIFFICULTIES:
        capped = apply_type_cap(deduped[diff])
        filled = refill(capped, candidates_by_diff.get(diff, []), MAX_PER_DIFFICULTY, seen)
        if len(filled) < MAX_PER_DIFFICULTY:
            raise ValueError(
                f"難度 {diff} 補題後只有 {len(filled)} 題"
                f"（目標 {MAX_PER_DIFFICULTY}），候選題不足"
            )
        result[diff] = filled
    return result


def main():
    seed_questions.set_rng(random.Random(REBALANCE_SEED))
    bank = load_existing_bank(OUTPUT_PATH)
    validate_questions(bank)

    candidates_by_diff = {
        "super_easy": seed_questions.gen_extra_super_easy(),
        "easy": seed_questions.gen_extra_easy(),
        "medium": seed_questions.gen_extra_medium(),
        "hard": seed_questions.gen_extra_hard(),
    }

    try:
        result = rebalance(bank, candidates_by_diff)
    except ValueError as exc:
        print(f"重平衡失敗，不更新 questions.json：{exc}", file=sys.stderr)
        sys.exit(1)

    for diff in DIFFICULTIES:
        for q in result[diff]:
            seed_questions.check_question_shape(q)
    validate_questions(result)

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
        f.write("\n")

    summary = "、".join(f"{d} {len(result[d])} 題" for d in DIFFICULTIES)
    print(f"已重平衡 questions.json：{summary}。")


if __name__ == "__main__":
    main()
