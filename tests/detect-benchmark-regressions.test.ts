import { expect, test } from "bun:test";
import type { BenchmarkReport } from "../scripts/benchmark/benchmark-types";
import {
  buildSummaryEntryMap,
  DEFAULT_THRESHOLDS,
  detectRegressions,
  normalizeBenchmarkReports,
  parseRateLabel,
  type RegressionReport,
} from "../scripts/benchmark/detect-benchmark-regressions";

const makeReport = ({
  datasetName,
  solverName = "AutoroutingPipelineSolver7_MultiGraph",
  effortLabel = "1x effort",
  completedRateLabel,
  relaxedDrcRateLabel = "100.0%",
  p50TimeMs,
  p95TimeMs = null,
  avgVia = null,
}: {
  datasetName: string;
  solverName?: string;
  effortLabel?: string;
  completedRateLabel: string;
  relaxedDrcRateLabel?: string;
  p50TimeMs: number | null;
  p95TimeMs?: number | null;
  avgVia?: number | null;
}): BenchmarkReport =>
  ({
    version: 1,
    datasetName,
    scenarioCount: 10,
    effortLabel,
    summary: [
      {
        solverName,
        completedRateLabel,
        relaxedDrcRateLabel,
        timedOutLabel: "0.0%",
        p50TimeMs,
        p95TimeMs,
        avgVia,
      },
    ],
    solverFailureSummary: [],
    timeoutSummary: [],
    failureSummary: [],
    snapshots: [],
    tests: [],
  }) as BenchmarkReport;

const compare = (
  current: BenchmarkReport[],
  baseline: BenchmarkReport[],
): RegressionReport =>
  detectRegressions({
    current: buildSummaryEntryMap(current, "current"),
    baseline: buildSummaryEntryMap(baseline, "baseline"),
    thresholds: DEFAULT_THRESHOLDS,
    baselineMissing: false,
  });

test("detects benchmark regressions and ignores expected noise", () => {
  expect(parseRateLabel({ label: "97.5%" })).toBe(97.5);
  expect(parseRateLabel({ label: "97.5% (timed out 2.5%)" })).toBe(97.5);
  expect(parseRateLabel({ label: "n/a" })).toBeNull();
  expect(() => parseRateLabel({ label: "bad data" })).toThrow(
    "Malformed rate label",
  );
  expect(() => parseRateLabel({ label: "97.5% garbage" })).toThrow(
    "Malformed rate label",
  );
  expect(() =>
    normalizeBenchmarkReports(
      {
        version: 1,
        datasetName: "srj16",
        effortLabel: "1x effort",
        summary: [],
      },
      "empty-summary",
    ),
  ).toThrow("Malformed benchmark report");
  expect(() =>
    normalizeBenchmarkReports(
      { version: 2, kind: "benchmark-report-collection", reports: [] },
      "empty-collection",
    ),
  ).toThrow("Malformed benchmark report");

  let report = compare(
    [
      makeReport({
        datasetName: "srj16",
        completedRateLabel: "92.5%",
        p50TimeMs: 1000,
      }),
    ],
    [
      makeReport({
        datasetName: "srj16",
        completedRateLabel: "97.5%",
        p50TimeMs: 1000,
      }),
    ],
  );
  expect(report.hasRegressions).toBe(true);
  let regression = report.regressions.find((r) => r.metric === "completedRate");
  expect(regression).toBeDefined();
  expect(regression?.datasetName).toBe("srj16");
  expect(regression?.delta).toBeCloseTo(-5);

  report = compare(
    [
      makeReport({
        datasetName: "srj16",
        completedRateLabel: "97.5%",
        p50TimeMs: 1100,
      }),
    ],
    [
      makeReport({
        datasetName: "srj16",
        completedRateLabel: "97.5%",
        p50TimeMs: 1000,
      }),
    ],
  );
  expect(report.hasRegressions).toBe(false);

  report = compare(
    [
      makeReport({
        datasetName: "srj16",
        completedRateLabel: "97.5%",
        p50TimeMs: 8,
      }),
    ],
    [
      makeReport({
        datasetName: "srj16",
        completedRateLabel: "97.5%",
        p50TimeMs: 4,
      }),
    ],
  );
  expect(report.hasRegressions).toBe(false);

  report = compare(
    [
      makeReport({
        datasetName: "srj16",
        completedRateLabel: "97.5%",
        p50TimeMs: 1500,
      }),
    ],
    [
      makeReport({
        datasetName: "srj16",
        completedRateLabel: "97.5%",
        p50TimeMs: 1000,
      }),
    ],
  );
  regression = report.regressions.find((r) => r.metric === "p50TimeMs");
  expect(regression).toBeDefined();
  expect(regression?.deltaPct).toBeCloseTo(50);

  report = compare(
    [
      makeReport({
        datasetName: "srj16",
        completedRateLabel: "n/a",
        p50TimeMs: null,
      }),
    ],
    [
      makeReport({
        datasetName: "srj16",
        completedRateLabel: "97.5%",
        p50TimeMs: 1000,
      }),
    ],
  );
  regression = report.regressions.find(
    (r) => r.metric === "p50TimeMs" && r.kind === "metric-null",
  );
  expect(regression).toBeDefined();
  expect(regression?.currentValue).toBeNull();
  expect(regression?.baselineValue).toBe(1000);

  report = compare(
    [
      makeReport({
        datasetName: "srj16",
        completedRateLabel: "97.5%",
        p50TimeMs: 1000,
      }),
    ],
    [
      makeReport({
        datasetName: "srj16",
        completedRateLabel: "97.5%",
        p50TimeMs: 1000,
      }),
      makeReport({
        datasetName: "dataset01",
        completedRateLabel: "100.0%",
        p50TimeMs: 500,
      }),
    ],
  );
  const dropped = report.regressions.find((r) => r.kind === "dataset-dropped");
  expect(dropped).toBeDefined();
  expect(dropped?.datasetName).toBe("dataset01");

  report = compare(
    [
      makeReport({
        datasetName: "srj16",
        completedRateLabel: "97.5%",
        p50TimeMs: 1000,
      }),
      makeReport({
        datasetName: "srj18",
        completedRateLabel: "90.0%",
        p50TimeMs: 2000,
      }),
    ],
    [
      makeReport({
        datasetName: "srj16",
        completedRateLabel: "97.5%",
        p50TimeMs: 1000,
      }),
    ],
  );
  expect(report.hasRegressions).toBe(false);
  expect(report.newDatasets).toHaveLength(1);
  expect(report.newDatasets[0].datasetName).toBe("srj18");

  report = detectRegressions({
    current: buildSummaryEntryMap(
      [
        makeReport({
          datasetName: "srj16",
          completedRateLabel: "97.5%",
          p50TimeMs: 1000,
        }),
      ],
      "current",
    ),
    baseline: new Map(),
    thresholds: DEFAULT_THRESHOLDS,
    baselineMissing: true,
  });
  expect(report.hasRegressions).toBe(false);
  expect(report.regressions).toHaveLength(0);

  const summaryMap = buildSummaryEntryMap(
    [
      makeReport({
        datasetName: "srj18",
        solverName: "AutoroutingPipelineSolver_Default",
        completedRateLabel: "90.0%",
        p50TimeMs: 2000,
      }),
      makeReport({
        datasetName: "srj18",
        solverName: "AutoroutingPipelineSolver7_MultiGraph",
        completedRateLabel: "95.0%",
        p50TimeMs: 2500,
      }),
    ],
    "current",
  );
  expect(summaryMap.size).toBe(2);

  expect(() =>
    buildSummaryEntryMap(
      [
        makeReport({
          datasetName: "srj18",
          completedRateLabel: "90.0%",
          p50TimeMs: 2000,
        }),
        makeReport({
          datasetName: "srj18",
          completedRateLabel: "95.0%",
          p50TimeMs: 2500,
        }),
      ],
      "current",
    ),
  ).toThrow("Duplicate benchmark summary key");
});
