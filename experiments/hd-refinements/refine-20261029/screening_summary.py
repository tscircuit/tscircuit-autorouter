"""Explicit six-board screening summary using frozen per-record math."""
from pathlib import Path
from multiarm_summary import build as full_summary, markdown as full_markdown

SAMPLES = {"srj18": [2, 11, 15], "srj24": [2, 11, 15]}


def build(root, config):
    summary = full_summary(root, config)
    reports = summary["perSampleDiagnostics"]
    expected = {(arm["id"], dataset, number) for arm in config["arms"] for dataset, samples in SAMPLES.items() for number in samples}
    actual = {(report["arm"], report["dataset"], report["sampleNumber"]) for report in reports}
    if actual - expected:
        raise ValueError("Unexpected result outside the six-board screening corpus")
    summary["screeningOnly"] = True
    summary["screeningSampleNumbers"] = SAMPLES
    summary["unmeasuredFullCorpusBoards"] = 36
    summary["resultProtocol"] = {"complete": actual == expected, "expectedCount": len(expected), "observedCount": len(actual), "missing": [list(key) for key in sorted(expected - actual)], "unexpected": []}
    for row in summary["rows"]:
        row["expectedCount"] = len(SAMPLES[row["dataset"]])
    summary["limitations"].insert(0, "SCREENING ONLY: srj18/24 samples2,11,15; 36of42 boards unmeasured. No full-corpus nonregression or optimization conclusion is possible.")
    return summary


def markdown(summary):
    text = full_markdown(summary)
    return "# Six-board screening only\n\n36of42 full-corpus boards are unmeasured.\n\n" + text
