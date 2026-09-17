"""Eval-only Gemini generation for Issue #46 before/after comparison.

NEVER writes production questions.json. Output goes only under --out-dir.
Old and calibrated prompts share MODEL_NAME, type_counts, and call settings.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from generate_questions import (  # noqa: E402
    DIFFICULTIES,
    MODEL_NAME,
    build_prompt,
    compute_type_counts,
    filter_valid_generated_questions,
    load_existing_bank,
    log_structured,
    normalize_question_text,
    parse_response_text,
)
from eval.blind import build_blind_pack, write_blind_artifacts  # noqa: E402
from eval.prompts_old import build_old_prompt  # noqa: E402
from eval.report import DEFAULT_MIN_PER_DIFFICULTY  # noqa: E402

DEFAULT_RUNS = 4
DEFAULT_BLIND_SEED = 20260916

# Transient Gemini HTTP statuses eligible for bounded retry (same generation run).
TRANSIENT_HTTP_STATUSES = frozenset({429, 500, 502, 503, 504})
# Max additional attempts after the first failure (not new independent runs).
GEMINI_TRANSIENT_MAX_RETRIES = 3
# Exponential backoff: base * 2^attempt → 1s, 2s, 4s for attempts 0..2.
GEMINI_RETRY_BASE_DELAY_S = 1.0


def extract_http_status(exc: BaseException) -> int | None:
    """Best-effort HTTP status from google-genai / httpx-style errors."""
    for attr in ("code", "status_code", "status"):
        val = getattr(exc, attr, None)
        if isinstance(val, int) and 100 <= val <= 599:
            return val
        if isinstance(val, str) and val.isdigit():
            code = int(val)
            if 100 <= code <= 599:
                return code
    # Nested response objects (e.g. exc.response.status_code).
    resp = getattr(exc, "response", None)
    if resp is not None:
        for attr in ("status_code", "status", "code"):
            val = getattr(resp, attr, None)
            if isinstance(val, int) and 100 <= val <= 599:
                return val
    match = re.search(r"\b([45]\d{2})\b", str(exc))
    if match:
        return int(match.group(1))
    return None


def is_transient_gemini_error(exc: BaseException) -> bool:
    """True only for retryable HTTP statuses (429/5xx listed)."""
    status = extract_http_status(exc)
    return status in TRANSIENT_HTTP_STATUSES


def call_gemini_once(api_key: str, prompt: str) -> str:
    """Single SDK call — same path / model / mime type as production call_gemini."""
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model=MODEL_NAME,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
        ),
    )
    try:
        return response.candidates[0].content.parts[0].text
    except (AttributeError, IndexError, KeyError, TypeError) as exc:
        raise ValueError(f"無法從 Gemini 回應取得內容：{exc}") from exc


def call_gemini_with_prompt(
    api_key: str,
    prompt: str,
    *,
    max_retries: int = GEMINI_TRANSIENT_MAX_RETRIES,
    base_delay_s: float = GEMINI_RETRY_BASE_DELAY_S,
    sleep_fn: Callable[[float], None] = time.sleep,
    call_fn: Callable[[str, str], str] | None = None,
) -> str:
    """Call Gemini with bounded exponential backoff on transient HTTP errors.

    Retries stay inside the same generation run (do not create a new run index).
    Non-transient errors fail immediately without retry.
    """
    do_call = call_fn or call_gemini_once
    attempt = 0
    while True:
        try:
            return do_call(api_key, prompt)
        except Exception as exc:  # noqa: BLE001
            if not is_transient_gemini_error(exc) or attempt >= max_retries:
                raise
            delay = base_delay_s * (2**attempt)
            log_structured(
                "warn",
                "eval Gemini transient error; retrying",
                {
                    "attempt": attempt + 1,
                    "max_retries": max_retries,
                    "delay_s": delay,
                    "status": extract_http_status(exc),
                    "error": str(exc),
                },
            )
            sleep_fn(delay)
            attempt += 1


def pool_questions(runs: list[dict]) -> dict[str, list]:
    """Merge valid questions across runs; dedupe by normalized q within difficulty."""
    pooled = {d: [] for d in DIFFICULTIES}
    seen = {d: set() for d in DIFFICULTIES}
    for run in runs:
        bank = run.get("filtered") or {}
        for diff in DIFFICULTIES:
            for q in bank.get(diff) or []:
                key = normalize_question_text(q.get("q", ""))
                if not key or key in seen[diff]:
                    continue
                seen[diff].add(key)
                pooled[diff].append(q)
    return pooled


def sample_balanced(
    pooled: dict[str, list],
    *,
    min_n: int,
    seed: int,
    version: str,
) -> dict[str, list]:
    """Deterministically select exactly min_n questions per difficulty.

    Uses configured blind/eval seed — never the raw model output count.
    Raises SystemExit when any difficulty has fewer than min_n pooled items.
    """
    assert_sample_size(pooled, min_n, version)
    sampled: dict[str, list] = {}
    for diff in DIFFICULTIES:
        items = list(pooled.get(diff) or [])
        rng = random.Random(f"{seed}|{version}|{diff}")
        rng.shuffle(items)
        sampled[diff] = items[:min_n]
    return sampled


def generate_version(
    *,
    api_key: str,
    version: str,
    prompt: str,
    runs: int,
    raw_dir: Path,
    sleep_s: float = 1.0,
) -> list[dict]:
    """Run N independent generations for one prompt version."""
    results = []
    raw_dir.mkdir(parents=True, exist_ok=True)
    for i in range(1, runs + 1):
        log_structured(
            "info",
            "eval Gemini call attempt",
            {"version": version, "run": i, "model": MODEL_NAME},
        )
        try:
            raw_text = call_gemini_with_prompt(api_key, prompt)
            parsed = parse_response_text(raw_text)
            filtered, exclusions = filter_valid_generated_questions(parsed)
            payload = {
                "version": version,
                "run": i,
                "raw_text_length": len(raw_text or ""),
                "filtered": filtered,
                "exclusions": exclusions,
                "counts": {d: len(filtered[d]) for d in DIFFICULTIES},
            }
            (raw_dir / f"{version}_run_{i:02d}.json").write_text(
                json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            results.append(payload)
            log_structured(
                "info",
                "eval Gemini call success",
                {"version": version, "run": i, "counts": payload["counts"]},
            )
        except Exception as exc:  # noqa: BLE001
            log_structured(
                "error",
                "eval Gemini call failed",
                {"version": version, "run": i, "error": str(exc)},
            )
            fail_payload = {
                "version": version,
                "run": i,
                "error": str(exc),
                "filtered": {d: [] for d in DIFFICULTIES},
                "exclusions": [],
                "counts": {d: 0 for d in DIFFICULTIES},
            }
            (raw_dir / f"{version}_run_{i:02d}.json").write_text(
                json.dumps(fail_payload, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            results.append(fail_payload)
        if i < runs and sleep_s > 0:
            time.sleep(sleep_s)
    return results


def assert_sample_size(pooled: dict[str, list], min_n: int, version: str) -> None:
    short = [d for d in DIFFICULTIES if len(pooled.get(d) or []) < min_n]
    if short:
        detail = {d: len(pooled.get(d) or []) for d in DIFFICULTIES}
        raise SystemExit(
            f"{version} sample size 不足（需要每難度 ≥{min_n}）：{detail}"
        )


def run_generation(args: argparse.Namespace) -> Path:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise SystemExit("錯誤：未設定環境變數 GEMINI_API_KEY（僅供 eval workflow 使用）")

    out_dir = Path(args.out_dir).resolve()
    # Safety: refuse to use production questions.json as output target.
    if out_dir.name == "questions.json" or str(out_dir).endswith("/questions.json"):
        raise SystemExit("拒絕：out-dir 不可為 production questions.json")

    out_dir.mkdir(parents=True, exist_ok=True)
    questions_path = Path(args.questions_path).resolve()
    # Read-only type_counts for identical generation conditions.
    existing = load_existing_bank(str(questions_path)) if questions_path.exists() else {}
    type_counts = compute_type_counts(existing)

    old_prompt = build_old_prompt(type_counts)
    cal_prompt = build_prompt(type_counts)

    prompts_dir = out_dir / "prompts"
    prompts_dir.mkdir(parents=True, exist_ok=True)
    (prompts_dir / "old.txt").write_text(old_prompt, encoding="utf-8")
    (prompts_dir / "calibrated.txt").write_text(cal_prompt, encoding="utf-8")

    raw_dir = out_dir / "raw"
    old_runs = generate_version(
        api_key=api_key,
        version="old",
        prompt=old_prompt,
        runs=args.runs,
        raw_dir=raw_dir,
        sleep_s=args.sleep,
    )
    cal_runs = generate_version(
        api_key=api_key,
        version="calibrated",
        prompt=cal_prompt,
        runs=args.runs,
        raw_dir=raw_dir,
        sleep_s=args.sleep,
    )

    pooled_old = pool_questions(old_runs)
    pooled_cal = pool_questions(cal_runs)
    pooled_dir = out_dir / "pooled"
    pooled_dir.mkdir(parents=True, exist_ok=True)
    (pooled_dir / "old.json").write_text(
        json.dumps(pooled_old, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (pooled_dir / "calibrated.json").write_text(
        json.dumps(pooled_cal, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    # Balanced eval sample: exactly min_per_difficulty per version×difficulty.
    # Blind pack must not use raw model output counts (AIOS harness finding).
    if args.allow_short_sample:
        sampled_old = pooled_old
        sampled_cal = pooled_cal
    else:
        sampled_old = sample_balanced(
            pooled_old,
            min_n=args.min_per_difficulty,
            seed=args.blind_seed,
            version="old",
        )
        sampled_cal = sample_balanced(
            pooled_cal,
            min_n=args.min_per_difficulty,
            seed=args.blind_seed,
            version="calibrated",
        )

    sampled_dir = out_dir / "sampled"
    sampled_dir.mkdir(parents=True, exist_ok=True)
    (sampled_dir / "old.json").write_text(
        json.dumps(sampled_old, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (sampled_dir / "calibrated.json").write_text(
        json.dumps(sampled_cal, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    items, key = build_blind_pack(
        {"old": sampled_old, "calibrated": sampled_cal},
        seed=args.blind_seed,
    )
    write_blind_artifacts(out_dir / "blind", items, key)

    meta = {
        "ts": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "model": MODEL_NAME,
        "runs_per_version": args.runs,
        "min_per_difficulty": args.min_per_difficulty,
        "blind_seed": args.blind_seed,
        "type_counts": type_counts,
        "pooled_sizes": {
            "old": {d: len(pooled_old[d]) for d in DIFFICULTIES},
            "calibrated": {d: len(pooled_cal[d]) for d in DIFFICULTIES},
        },
        "sample_sizes": {
            "old": {d: len(sampled_old[d]) for d in DIFFICULTIES},
            "calibrated": {d: len(sampled_cal[d]) for d in DIFFICULTIES},
        },
        "gemini_transient_max_retries": GEMINI_TRANSIENT_MAX_RETRIES,
        "production_questions_modified": False,
        "note": "Eval-only artifact. Do not commit into questions.json.",
    }
    (out_dir / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    # Guardrail marker: confirm questions.json was not written by this process.
    (out_dir / "SAFETY.md").write_text(
        "# Safety\n\n"
        "- This evaluation does **not** modify production `questions.json`.\n"
        "- Do **not** commit pooled questions into the repository bank.\n"
        "- Do **not** wire this workflow into update_questions / deploy.\n",
        encoding="utf-8",
    )
    print(json.dumps({"ok": True, "out_dir": str(out_dir), "meta": meta}, ensure_ascii=False))
    return out_dir


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Issue #46 eval-only generation + blinding")
    p.add_argument(
        "--out-dir",
        default="eval_output",
        help="Artifact directory (never questions.json)",
    )
    p.add_argument(
        "--questions-path",
        default="questions.json",
        help="Read-only path for type_counts (not written)",
    )
    p.add_argument("--runs", type=int, default=DEFAULT_RUNS, help="Runs per prompt version")
    p.add_argument(
        "--min-per-difficulty",
        type=int,
        default=DEFAULT_MIN_PER_DIFFICULTY,
    )
    p.add_argument("--blind-seed", type=int, default=DEFAULT_BLIND_SEED)
    p.add_argument("--sleep", type=float, default=1.0, help="Seconds between Gemini calls")
    p.add_argument(
        "--allow-short-sample",
        action="store_true",
        help="Do not fail when pooled sample < min-per-difficulty (debug only)",
    )
    return p


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    run_generation(args)


if __name__ == "__main__":
    main()
