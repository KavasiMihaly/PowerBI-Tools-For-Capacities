# v0.7.1 Baseline Test Results

These `.txt` files are pre-existing v0.7.1 test runs against the demo dataset, captured by the original `ChromeWriteBack.exe` writeback hook. Each line is one refresh's `divCounter.innerHTML` payload (HTML-with-`<br>` separators — see `_Research/realisticloadtest-fork-vs-upstream.md` §3 for the format).

These serve as the **regression-comparison reference for TEST-V08-10** (performance regression vs v0.7.1) per `_Test/v0.8-test-plan.md`. When TP3 is completed, a `v0.7.1-summary.md` will sit alongside this folder containing the avg / p50 / p95 / count aggregates.

| File | Run timestamp | Approx duration |
|---|---|---|
| `UK Combined Dataset - UK Combined Dataset - 02-04-25_001149.txt` | 2025-02-04 00:11:49 GMT | ~10-15 min |
| `UK Combined Dataset - UK Combined Dataset - 02-04-25_003119.txt` | 2025-02-04 00:31:19 GMT | ~10 min |

Both runs used the demo `.pbix` (UK Combined Dataset) with `numberOfViews=15` and `thinkTimeSeconds=1`. Dataset and report names are visible in the file paths.

**Note:** these files were originally written under `RealisticLoadTestTool/Test Results/`. They were copied here so the `.gitignore` rule that excludes live test-run output (`RealisticLoadTestTool/Test Results/*.txt`) doesn't drop them.
