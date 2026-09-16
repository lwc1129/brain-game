"""Aggregate unblinded ratings into before/after metrics + report."""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from generate_questions import DIFFICULTIES
from eval.rubric import VERDICTS

# Issue #46 Acceptance Criteria thresholds (calibrated sample only)
AC_MEDIUM_FIT_MIN = 0.65
AC_HARD_FIT_MIN = 0.60
AC_OVERALL_TOO_HARD_MAX = 0.10


def _rate(count: int, total: int) -> float | None:
    if total <= 0:
        return None
    return count / total


def summarize(unblinded: list[dict[str, Any]]) -> dict[str, Any]:
    """Build nested metrics: version → difficulty → verdict counts + rates."""
    by_vd: dict[str, dict[str, Counter]] = {
        "old": {d: Counter() for d in DIFFICULTIES},
        "calibrated": {d: Counter() for d in DIFFICULTIES},
    }
    qi_counts: dict[str, Counter] = {
        "old": Counter(),
        "calibrated": Counter(),
    }
    totals: dict[str, Counter] = {
        "old": Counter(),
        "calibrated": Counter(),
    }

    for row in unblinded:
        version = row["version"]
        diff = row["difficulty"]
        verdict = row["verdict"]
        if version not in by_vd or diff not in by_vd[version]:
            continue
        by_vd[version][diff][verdict] += 1
        totals[version][diff] += 1
        if row.get("quality_issue"):
            qi_counts[version][diff] += 1

    result: dict[str, Any] = {"versions": {}, "acceptance": {}}
    for version in ("old", "calibrated"):
        vdata: dict[str, Any] = {"by_difficulty": {}, "overall": {}}
        overall_verdicts = Counter()
        overall_n = 0
        overall_qi = 0
        for diff in DIFFICULTIES:
            n = totals[version][diff]
            counts = {v: by_vd[version][diff][v] for v in VERDICTS}
            overall_verdicts.update(by_vd[version][diff])
            overall_n += n
            overall_qi += qi_counts[version][diff]
            vdata["by_difficulty"][diff] = {
                "n": n,
                "counts": counts,
                "fit_rate": _rate(counts["FIT"], n),
                "too_easy_rate": _rate(counts["TOO_EASY"], n),
                "too_hard_rate": _rate(counts["TOO_HARD"], n),
                "wrong_tier_rate": _rate(counts["WRONG_TIER"], n),
                "quality_issue_count": qi_counts[version][diff],
                "quality_issue_rate": _rate(qi_counts[version][diff], n),
            }
        oc = {v: overall_verdicts[v] for v in VERDICTS}
        vdata["overall"] = {
            "n": overall_n,
            "counts": oc,
            "fit_rate": _rate(oc["FIT"], overall_n),
            "too_hard_rate": _rate(oc["TOO_HARD"], overall_n),
            "quality_issue_count": overall_qi,
            "quality_issue_rate": _rate(overall_qi, overall_n),
        }
        result["versions"][version] = vdata

    cal = result["versions"]["calibrated"]
    med_fit = cal["by_difficulty"]["medium"]["fit_rate"]
    hard_fit = cal["by_difficulty"]["hard"]["fit_rate"]
    too_hard = cal["overall"]["too_hard_rate"]

    def _status(ok: bool | None) -> str:
        if ok is None:
            return "PENDING"
        return "PASS" if ok else "FAIL"

    med_ok = None if med_fit is None else med_fit >= AC_MEDIUM_FIT_MIN
    hard_ok = None if hard_fit is None else hard_fit >= AC_HARD_FIT_MIN
    th_ok = None if too_hard is None else too_hard <= AC_OVERALL_TOO_HARD_MAX

    result["acceptance"] = {
        "calibrated_medium_fit": {
            "value": med_fit,
            "threshold": AC_MEDIUM_FIT_MIN,
            "status": _status(med_ok),
        },
        "calibrated_hard_fit": {
            "value": hard_fit,
            "threshold": AC_HARD_FIT_MIN,
            "status": _status(hard_ok),
        },
        "calibrated_overall_too_hard": {
            "value": too_hard,
            "threshold": AC_OVERALL_TOO_HARD_MAX,
            "status": _status(th_ok),
        },
    }
    statuses = [
        result["acceptance"][k]["status"]
        for k in (
            "calibrated_medium_fit",
            "calibrated_hard_fit",
            "calibrated_overall_too_hard",
        )
    ]
    if any(s == "PENDING" for s in statuses):
        result["acceptance"]["overall"] = "PENDING"
    elif all(s == "PASS" for s in statuses):
        result["acceptance"]["overall"] = "PASS"
    else:
        result["acceptance"]["overall"] = "FAIL"
    return result


def render_markdown_report(metrics: dict[str, Any], *, meta: dict[str, Any] | None = None) -> str:
    """Human-readable before/after report."""
    lines = [
        "# Issue #46 Difficulty Calibration — Before/After Report",
        "",
        "> Generated after blind rating + unblinding. QUALITY_ISSUE is reported",
        "> independently and is **not** a production semantic gate.",
        "",
    ]
    if meta:
        lines.append("## Generation meta")
        lines.append("")
        lines.append(f"- Model: `{meta.get('model')}`")
        lines.append(f"- Runs per version: {meta.get('runs_per_version')}")
        lines.append(f"- Min per difficulty target: {meta.get('min_per_difficulty')}")
        lines.append("")

    lines.extend(["## Sample sizes", ""])
    lines.append("| Version | super_easy | easy | medium | hard | total |")
    lines.append("|---|---:|---:|---:|---:|---:|")
    for version in ("old", "calibrated"):
        vd = metrics["versions"][version]
        cells = [str(vd["by_difficulty"][d]["n"]) for d in DIFFICULTIES]
        lines.append(
            f"| {version} | " + " | ".join(cells) + f" | {vd['overall']['n']} |"
        )
    lines.append("")

    lines.extend(["## FIT rates", ""])
    lines.append("| Difficulty | Old FIT | Calibrated FIT |")
    lines.append("|---|---:|---:|")
    for diff in DIFFICULTIES:
        old_r = metrics["versions"]["old"]["by_difficulty"][diff]["fit_rate"]
        cal_r = metrics["versions"]["calibrated"]["by_difficulty"][diff]["fit_rate"]

        def fmt(r):
            return "n/a" if r is None else f"{r:.1%}"

        lines.append(f"| {diff} | {fmt(old_r)} | {fmt(cal_r)} |")
    lines.append("")

    lines.extend(["## TOO_HARD rates (overall)", ""])
    for version in ("old", "calibrated"):
        r = metrics["versions"][version]["overall"]["too_hard_rate"]
        n = metrics["versions"][version]["overall"]["n"]
        lines.append(
            f"- **{version}**: "
            + ("n/a" if r is None else f"{r:.1%} ({metrics['versions'][version]['overall']['counts']['TOO_HARD']}/{n})")
        )
    lines.append("")

    lines.extend(["## QUALITY_ISSUE (independent, not a gate)", ""])
    for version in ("old", "calibrated"):
        qi = metrics["versions"][version]["overall"]["quality_issue_count"]
        n = metrics["versions"][version]["overall"]["n"]
        r = metrics["versions"][version]["overall"]["quality_issue_rate"]
        lines.append(
            f"- **{version}**: {qi}/{n}"
            + ("" if r is None else f" ({r:.1%})")
        )
    lines.append("")

    lines.extend(["## Acceptance Criteria (calibrated only)", ""])
    ac = metrics["acceptance"]
    lines.append(
        f"- medium FIT ≥ 65%: "
        f"{ac['calibrated_medium_fit']['status']} "
        f"(value={ac['calibrated_medium_fit']['value']})"
    )
    lines.append(
        f"- hard FIT ≥ 60%: "
        f"{ac['calibrated_hard_fit']['status']} "
        f"(value={ac['calibrated_hard_fit']['value']})"
    )
    lines.append(
        f"- overall TOO_HARD ≤ 10%: "
        f"{ac['calibrated_overall_too_hard']['status']} "
        f"(value={ac['calibrated_overall_too_hard']['value']})"
    )
    lines.append(f"- **Overall AC: {ac['overall']}**")
    lines.append("")
    return "\n".join(lines) + "\n"


def write_report(
    out_dir: Path,
    unblinded: list[dict[str, Any]],
    *,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)
    metrics = summarize(unblinded)
    (out_dir / "metrics.json").write_text(
        json.dumps(metrics, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (out_dir / "unblinded_ratings.json").write_text(
        json.dumps(unblinded, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    md = render_markdown_report(metrics, meta=meta)
    (out_dir / "before_after.md").write_text(md, encoding="utf-8")
    return metrics
