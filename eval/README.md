# Issue #46 Difficulty Evaluation Harness

Eval-only tooling for before/after difficulty prompt calibration.

## Boundaries

- `workflow_dispatch` only (see `.github/workflows/difficulty-eval.yml`)
- Not scheduled; not called by `update_questions.yml` / deploy
- Never writes or commits production `questions.json`
- Gemini credentials stay in GitHub Actions secrets

## Flow

1. **Generate** (GHA): old prompt + calibrated prompt, same model / type_counts / call settings, ≥3 runs, ≥30 questions per difficulty per version → `eval_output/`
2. **Blind**: shuffle, strip version, assign anonymous IDs → `blind/pack.json` + `blind/key.json`
3. **Rate**: fill `rating_sheet.csv` or run `python -m eval.rate_blind --pack ... --out ...` **without reading key.json**
4. **Unblind + report**: `python -m eval.unblind_report --eval-dir eval_output --ratings ...`

## Local dry-run (no Gemini)

Unit tests cover blinding / reporting / prompt contracts. Generation requires `GEMINI_API_KEY` and should be run via the eval workflow.
