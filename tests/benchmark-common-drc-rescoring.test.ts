import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "../lib/testing/evaluate-relaxed-drc"
import type {
  BenchmarkDrcInput,
  BenchmarkReport,
} from "../scripts/benchmark/benchmark-types"
import { rescoreBenchmarkReport } from "../scripts/benchmark/rescore-benchmark-results"

test("common DRC rescoring preserves native detection and routing timing", () => {
  const solverName = "AutoroutingPipelineSolver9_PreloadedTraceGraph"
  const inputSrj = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [],
    connections: [
      {
        name: "horizontal",
        pointsToConnect: [
          { x: -2, y: 0, layer: "bottom" },
          { x: 2, y: 0, layer: "bottom" },
        ],
      },
      {
        name: "vertical",
        pointsToConnect: [
          { x: 0, y: -2, layer: "bottom" },
          { x: 0, y: 2, layer: "bottom" },
        ],
      },
    ],
  }
  const drcInput: BenchmarkDrcInput = {
    inputSrj,
    srjWithPointPairs: inputSrj,
    routedTraces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "horizontal",
        connection_name: "horizontal",
        route: [
          { route_type: "wire", x: -2, y: 0, width: 0.15, layer: "bottom" },
          { route_type: "wire", x: 2, y: 0, width: 0.15, layer: "bottom" },
        ],
      },
      {
        type: "pcb_trace",
        pcb_trace_id: "vertical",
        connection_name: "vertical",
        route: [
          { route_type: "wire", x: 0, y: -2, width: 0.15, layer: "bottom" },
          { route_type: "wire", x: 0, y: 2, width: 0.15, layer: "bottom" },
        ],
      },
    ],
  }
  const report: BenchmarkReport = {
    version: 1,
    datasetName: "srj18",
    scenarioCount: 1,
    effortLabel: "1x effort",
    solverFailureSummary: [],
    timeoutSummary: [],
    failureSummary: [],
    snapshots: [],
    summary: [
      {
        solverName,
        completedRateLabel: "100.0%",
        relaxedDrcRateLabel: "100.0%",
        timedOutLabel: "0/1",
        p50TimeMs: 12,
        p95TimeMs: 12,
        avgVia: 0,
      },
    ],
    tests: [
      {
        solverName,
        scenarioName: "sample1",
        sampleNumber: 1,
        elapsedTimeMs: 12,
        didSolve: true,
        didTimeout: false,
        relaxedDrcPassed: true,
        drcErrorCount: 0,
        drcEvaluationTimeMs: 3,
        drcInput,
      },
    ],
  }
  const expected = evaluateRelaxedDrc(drcInput).errors.length
  expect(expected).toBeGreaterThan(0)
  const rescored = rescoreBenchmarkReport(
    report,
    evaluateRelaxedDrc,
    "a".repeat(40),
  )
  expect(rescored.tests[0].drcErrorCount).toBe(expected)
  expect(rescored.tests[0].relaxedDrcPassed).toBe(false)
  expect(rescored.tests[0].nativeDrc).toEqual({
    passed: true,
    errorCount: 0,
    evaluationTimeMs: 3,
  })
  expect(rescored.tests[0].elapsedTimeMs).toBe(12)
  expect(rescored.tests[0].commonDrcEvaluationTimeMs).toBeGreaterThanOrEqual(0)
  expect(rescored.tests[0].drcInput).toBeUndefined()
  expect(rescored.summary[0].relaxedDrcRateLabel).toBe("0.0%")
  expect(report.tests[0].drcErrorCount).toBe(0)
  expect(report.tests[0].drcInput).toBe(drcInput)
  const replacedInput: BenchmarkDrcInput = {
    ...drcInput,
    inputSrj: {
      ...inputSrj,
      traces: [
        {
          ...drcInput.routedTraces[0],
          pcb_trace_id: "old-horizontal",
          route: drcInput.routedTraces[0].route.map((point) => ({
            ...point,
            y: 4,
          })),
        },
      ],
    },
    routedTraces: [
      {
        ...drcInput.routedTraces[0],
        __replaces_pcb_trace_id: "old-horizontal",
      },
      drcInput.routedTraces[1],
    ],
  }
  const replacementScore = rescoreBenchmarkReport(
    { ...report, tests: [{ ...report.tests[0], drcInput: replacedInput }] },
    evaluateRelaxedDrc,
    "a".repeat(40),
  )
  expect(replacementScore.tests[0].routedGeometryHash).toBe(
    rescored.tests[0].routedGeometryHash,
  )
  const changedInput: BenchmarkDrcInput = {
    ...drcInput,
    routedTraces: [
      {
        ...drcInput.routedTraces[0],
        route: drcInput.routedTraces[0].route.map((point) => ({
          ...point,
          y: 3,
        })),
      },
      drcInput.routedTraces[1],
    ],
  }
  const changedScore = rescoreBenchmarkReport(
    { ...report, tests: [{ ...report.tests[0], drcInput: changedInput }] },
    evaluateRelaxedDrc,
    "a".repeat(40),
  )
  expect(changedScore.tests[0].routedGeometryHash).not.toBe(
    rescored.tests[0].routedGeometryHash,
  )
  expect(() =>
    rescoreBenchmarkReport(rescored, evaluateRelaxedDrc, "a".repeat(40)),
  ).toThrow("already rescored")
  expect(() =>
    rescoreBenchmarkReport(
      { ...report, tests: [{ ...report.tests[0], drcInput: undefined }] },
      evaluateRelaxedDrc,
      "a".repeat(40),
    ),
  ).toThrow("Missing captured DRC input")
})
