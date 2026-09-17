"""Blinding / unblinding helpers for Issue #46 difficulty evaluation.

Blind pack keeps claimed difficulty (needed for FIT) but removes prompt
version / run metadata. Unblinding rejoins ratings with the key.
"""

from __future__ import annotations

import csv
import hashlib
import json
import random
from pathlib import Path
from typing import Any

from generate_questions import DIFFICULTIES


def _stable_anon_id(seed: str, version: str, difficulty: str, index: int, qtext: str) -> str:
    raw = f"{seed}|{version}|{difficulty}|{index}|{qtext}"
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:10].upper()
    return f"Q-{digest}"


def build_blind_pack(
    pooled: dict[str, dict[str, list]],
    *,
    seed: int = 20260916,
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    """Shuffle old+calibrated items into anonymous pack + key.

    pooled = {"old": {diff: [q,...]}, "calibrated": {diff: [q,...]}}
    """
    rng = random.Random(seed)
    items: list[dict[str, Any]] = []
    key: dict[str, dict[str, Any]] = {}

    for version in ("old", "calibrated"):
        bank = pooled.get(version) or {}
        for diff in DIFFICULTIES:
            for idx, q in enumerate(bank.get(diff) or []):
                if not isinstance(q, dict):
                    continue
                qtext = q.get("q", "")
                anon = _stable_anon_id(str(seed), version, diff, idx, str(qtext))
                # Collision guard (extremely unlikely with 10 hex chars).
                while anon in key:
                    anon = _stable_anon_id(
                        str(seed), version, diff, idx, f"{qtext}#{len(key)}"
                    )
                blind_item = {
                    "id": anon,
                    "difficulty": diff,
                    "type": q.get("type"),
                    "q": q.get("q"),
                    "a": q.get("a"),
                    "opts": list(q.get("opts") or []),
                }
                items.append(blind_item)
                key[anon] = {
                    "version": version,
                    "difficulty": diff,
                    "index": idx,
                    "q": q.get("q"),
                }

    rng.shuffle(items)
    return items, key


def write_blind_artifacts(
    out_dir: Path,
    items: list[dict[str, Any]],
    key: dict[str, dict[str, Any]],
) -> None:
    """Write pack.json, key.json, rating_sheet.csv, RUBRIC.txt."""
    out_dir.mkdir(parents=True, exist_ok=True)
    pack_path = out_dir / "pack.json"
    key_path = out_dir / "key.json"
    sheet_path = out_dir / "rating_sheet.csv"
    rubric_path = out_dir / "RUBRIC.txt"

    pack_path.write_text(
        json.dumps({"items": items}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    key_path.write_text(
        json.dumps(key, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    from eval.rubric import RUBRIC_SUMMARY

    rubric_path.write_text(RUBRIC_SUMMARY + "\n", encoding="utf-8")

    with sheet_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "id",
                "difficulty",
                "type",
                "q",
                "a",
                "opts",
                "rated_band",
                "verdict",
                "quality_issue",
                "reason",
            ],
        )
        writer.writeheader()
        for item in items:
            writer.writerow(
                {
                    "id": item["id"],
                    "difficulty": item["difficulty"],
                    "type": item.get("type", ""),
                    "q": item.get("q", ""),
                    "a": item.get("a", ""),
                    "opts": " | ".join(item.get("opts") or []),
                    "rated_band": "",
                    "verdict": "",
                    "quality_issue": "",
                    "reason": "",
                }
            )


def load_ratings(path: Path) -> list[dict[str, Any]]:
    """Load ratings from JSON list or CSV rating sheet."""
    text = path.read_text(encoding="utf-8")
    if path.suffix.lower() == ".json":
        data = json.loads(text)
        if isinstance(data, dict) and "ratings" in data:
            return data["ratings"]
        if isinstance(data, list):
            return data
        raise ValueError("ratings JSON 必須是 list 或 {ratings: [...]}")

    rows = []
    with path.open(encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if not row.get("id"):
                continue
            if not str(row.get("verdict") or "").strip() and not str(
                row.get("rated_band") or ""
            ).strip():
                continue
            rows.append(row)
    return rows


def unblind_ratings(
    ratings: list[dict[str, Any]],
    key: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Attach version metadata from key to each rating row."""
    from eval.rubric import verdict_from_bands

    merged = []
    for row in ratings:
        rid = row.get("id")
        if rid not in key:
            raise ValueError(f"rating id 不在 blind key 中：{rid}")
        meta = key[rid]
        rated_band_raw = row.get("rated_band")
        verdict = str(row.get("verdict") or "").strip().upper()
        if rated_band_raw not in (None, "") and not verdict:
            verdict = verdict_from_bands(meta["difficulty"], int(rated_band_raw))
        qi = row.get("quality_issue")
        if isinstance(qi, str):
            qi_norm = qi.strip().lower() in ("1", "true", "yes", "y", "是")
        else:
            qi_norm = bool(qi)
        merged.append(
            {
                "id": rid,
                "version": meta["version"],
                "difficulty": meta["difficulty"],
                "rated_band": (
                    int(rated_band_raw)
                    if rated_band_raw not in (None, "")
                    else None
                ),
                "verdict": verdict,
                "quality_issue": qi_norm,
                "reason": row.get("reason") or "",
                "q": meta.get("q"),
            }
        )
    return merged
