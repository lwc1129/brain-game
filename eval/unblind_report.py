"""Apply blind ratings + unblind + write before/after report.

Ratings may come from a filled CSV/JSON sheet. This script never needs
Gemini credentials.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from eval.blind import load_ratings, unblind_ratings  # noqa: E402
from eval.report import write_report  # noqa: E402


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description="Unblind ratings and write AC report")
    p.add_argument("--eval-dir", default="eval_output", help="Generation artifact dir")
    p.add_argument(
        "--ratings",
        required=True,
        help="Path to filled rating_sheet.csv or ratings.json",
    )
    p.add_argument(
        "--report-dir",
        default=None,
        help="Report output dir (default: <eval-dir>/report)",
    )
    args = p.parse_args(argv)

    eval_dir = Path(args.eval_dir)
    key_path = eval_dir / "blind" / "key.json"
    if not key_path.exists():
        raise SystemExit(f"找不到 blind key：{key_path}")
    key = json.loads(key_path.read_text(encoding="utf-8"))
    ratings = load_ratings(Path(args.ratings))
    unblinded = unblind_ratings(ratings, key)

    meta_path = eval_dir / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else None
    report_dir = Path(args.report_dir) if args.report_dir else eval_dir / "report"
    metrics = write_report(report_dir, unblinded, meta=meta)
    print(
        json.dumps(
            {
                "ok": True,
                "report_dir": str(report_dir),
                "acceptance": metrics["acceptance"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
