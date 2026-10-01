import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 repairs SRJ18 sample 3 at default effort", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 3)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { effort: 1, cacheProvider: null },
  )

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(
    evaluateRelaxedDrc({
      inputSrj: scenario,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: solver.getOutputSimplifiedPcbTraces(),
    }).errors,
  ).toHaveLength(0)
}, 120_000)

test("Pipeline9 repairs SRJ18 sample 3 at 2x effort", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 3)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    {
      effort: 2,
      cacheProvider: null,
      dynamicNetTreeRouting: {
        enabled: true,
        nets: [
          {
            net: scenario.connections[0]!.name,
            maxNewVias: 2,
            maxNewViasPerBranch: 1,
          },
        ],
        objective: {
          priorities: ["viaSites", "copperLength", "bends"],
          maxCopperLengthIncrease: 0,
          maxBendIncrease: 0,
          maxChangedNets: 1,
        },
        search: {
          gridStep: 0.5,
          viaCost: 3,
          bendCost: 0.05,
          maxExpansions: 300_000,
          maxMilliseconds: 5_000,
        },
      },
    },
  )
  let solveError: unknown
  try {
    solver.solve()
  } catch (error) {
    solveError = error
  }

  const routedTraces = solver.solved
    ? solver.getOutputSimplifiedPcbTraces()
    : [
        ...(
          solver.powerTraceExpansionSolver!.inputSrj as typeof scenario & {
            fixedTraces: typeof scenario.traces
          }
        ).fixedTraces!,
        ...solver.powerTraceExpansionSolver!.getOutput(),
      ]
  const output = {
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
  }
  const snapshotPath =
    process.platform === "linux"
      ? import.meta.path.replace(/\.test\.ts$/, "-linux.test.ts")
      : import.meta.path
  // Keep the same expected path and actual pre-phase copper on a phase failure.
  const svg = getBugReportSnapshotSvg(output)
  const result = solver.getPostRoutingOptimizationResult()
  const phaseDiagnostic =
    solver.error?.replace(/[&<>]/g, " ") ??
    `${result?.status}: ${result?.diagnostics.join("; ")}; validation=${result?.validationStatus}`
  const observed = svg.replace(
    "</svg>",
    `<text x="12" y="78" font-size="12" fill="#9f1239">${phaseDiagnostic}</text></svg>`,
  )
  await expect(observed).toMatchSvgSnapshot(snapshotPath)
  if (solveError) throw solveError
  expect(result?.status).toBe("unsupported")
  expect(result?.validationStatus).toBe("unsupported")
  expect(result?.attempts).toEqual([])
  expect(routedTraces).toEqual([
    ...(
      solver.powerTraceExpansionSolver!.inputSrj as typeof scenario & {
        fixedTraces: NonNullable<typeof scenario.traces>
      }
    ).fixedTraces,
    ...solver.powerTraceExpansionSolver!.getOutput(),
  ])
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.traceSimplificationSolver?.simplificationPipelineLoops).toBe(2)
  expect(solver.effortCleanupSolver?.completedPasses).toBe(2)
  expect(evaluateRelaxedDrc(output).errors).toHaveLength(0)
}, 120_000)
