import { expect, test } from "bun:test"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

type OfficialDrcErrors = ReturnType<typeof evaluateRelaxedDrc>["errors"]

test("Pipeline9 clears SRJ21 sample1's two formerly retained pad pairs", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj21", 1)
  // Both legacy failures involve newly routed wires, not immutable preloads:
  // source_trace_9 / pcb_port_24 and source_trace_6 / pcb_port_19.
  expect(scenario.traces ?? []).toHaveLength(0)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )
  const stageOutputs: Record<string, () => HighDensityRoute[]> = {
    highDensityRepairSolver: () => solver.highDensityRepairSolver!.getOutput(),
    highDensityDrcRepairSolver: () =>
      solver.highDensityDrcRepairSolver!.getOutput(),
    highDensityStitchSolver: () =>
      solver.highDensityStitchSolver!.mergedHdRoutes,
    traceSimplificationSolver: () =>
      solver.traceSimplificationSolver!.simplifiedHdRoutes,
    traceWidthSolver: () => solver.traceWidthSolver!.getHdRoutesWithWidths(),
    globalDrcForceImproveSolver: () =>
      solver.globalDrcForceImproveSolver!.getOutput(),
    pipeline9JointDrcRepairSolver: () =>
      solver.pipeline9JointDrcRepairSolver!.getOutput(),
    lengthMatchingPostProcessingSolver: () =>
      solver.lengthMatchingPostProcessingSolver!.getOutput().hdRoutes,
  }
  let finalHandoffErrors: OfficialDrcErrors | undefined
  const visitedStages = new Set<string>()
  const logStageCopper = (
    stage: string,
    hdRoutes: HighDensityRoute[],
    elapsedTimeMs: number,
  ): void => {
    const routedTraces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
      connections: solver.netToPointPairsSolver!.newConnections,
      originalConnections: solver.originalSrj.connections,
      hdRoutes,
      layerCount: solver.srj.layerCount,
      obstacles: solver.srj.obstacles,
      defaultViaHoleDiameter: solver.viaHoleDiameter,
      connMap: solver.connMap,
    })
    const isFinalHandoff = stage === "lengthMatchingPostProcessingSolver"
    const { errors, errorsWithCenters, circuitJson } = evaluateRelaxedDrc({
      inputSrj: scenario,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces,
      // Unstitched fragments are not individually terminal-contiguous. At the
      // last HD handoff, use the complete benchmark rules for output parity.
      drcOptions: isFinalHandoff
        ? undefined
        : { includeTraceContinuity: false, includeBoardEdge: false },
    })
    if (isFinalHandoff) finalHandoffErrors = structuredClone(errors)
    visitedStages.add(stage)
    console.info(
      JSON.stringify({
        dataset: "srj21",
        sampleNumber: 1,
        stage,
        elapsedTimeMs,
        copperDrcIssueCount: errors.length,
        copperErrors: errorsWithCenters,
        targetPads: circuitJson.filter(
          (element) =>
            element.type === "pcb_smtpad" &&
            (element.pcb_port_id === "pcb_port_24" ||
              element.pcb_port_id === "pcb_port_19"),
        ),
        targetRoutes: hdRoutes
          .filter(
            (route) =>
              route.rootConnectionName === "source_trace_9" ||
              route.rootConnectionName === "source_trace_6" ||
              route.connectionName === "source_trace_9" ||
              route.connectionName === "source_trace_6",
          )
          .map((route) => ({
            connectionName: route.connectionName,
            regionId: route.regionId,
            traceThickness: route.traceThickness,
            viaDiameter: route.viaDiameter,
            route: route.route,
            vias: route.vias,
          })),
        highDensityStats:
          stage === "highDensityDrcRepairSolver"
            ? solver.highDensityDrcRepairSolver!.stats
            : undefined,
      }),
    )
  }

  let stageElapsedTimeMs = 0
  while (!solver.solved && !solver.failed) {
    const stage = solver.getCurrentPhase()
    const stepStartedAt = performance.now()
    solver.step()
    // Do not include diagnostic checks and logging in solver-stage timings.
    stageElapsedTimeMs += performance.now() - stepStartedAt
    if (solver.getCurrentPhase() !== stage) {
      if (stageOutputs[stage]) {
        logStageCopper(stage, stageOutputs[stage]!(), stageElapsedTimeMs)
      }
      stageElapsedTimeMs = 0
    }
  }

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect([...visitedStages]).toEqual(Object.keys(stageOutputs))
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  console.info(
    JSON.stringify({ dataset: "srj21", sampleNumber: 1, stage: "final", errors }),
  )
  expect(finalHandoffErrors).toBeDefined()
  expect(errors).toEqual(finalHandoffErrors)
  // Same-machine f81b7519 benchmark confirms both formerly retained pairs clear.
  expect(errors).toHaveLength(0)
})
