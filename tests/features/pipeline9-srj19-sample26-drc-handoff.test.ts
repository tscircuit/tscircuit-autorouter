import { expect, test } from "bun:test"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 preserves DRC-clean copper through SRJ19 sample 26", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj19", 26)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )
  const targetConnectionName = "bga_conn_012__passive_conn_019_mst0"
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
  }
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
    const { errors, errorsWithCenters } = evaluateRelaxedDrc({
      inputSrj: scenario,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces,
      // Diagnose copper before fragments become terminal-contiguous.
      drcOptions: { includeTraceContinuity: false, includeBoardEdge: false },
    })
    if (
      stage === "highDensityRepairSolver" ||
      stage === "highDensityDrcRepairSolver" ||
      stage === "highDensityStitchSolver"
    ) {
      const targetRoutes = hdRoutes.flatMap((route, globalRouteIndex) =>
        route.connectionName === targetConnectionName
          ? [{ globalRouteIndex, ...route }]
          : [],
      )
      const targetNodeIds = new Set(targetRoutes.map((route) => route.regionId))
      console.info(
        JSON.stringify({
          dataset: "srj19",
          sampleNumber: 26,
          stage,
          diagnostic: "target-connection-stitch-geometry",
          connection: solver.netToPointPairsSolver!.newConnections.find(
            (connection) => connection.name === targetConnectionName,
          ),
          hdRoutes: targetRoutes.map((route, fragmentIndex) => ({
            fragmentIndex,
            ...route,
          })),
          serializedTraces: routedTraces.filter((trace) =>
            trace.pcb_trace_id.startsWith(`${targetConnectionName}_`),
          ),
          nodes: solver.highDensityNodePortPoints
            ?.filter((node) => targetNodeIds.has(node.capacityMeshNodeId))
            .map((node) => ({
              capacityMeshNodeId: node.capacityMeshNodeId,
              center: node.center,
              width: node.width,
              height: node.height,
              portPoints: node.portPoints.filter(
                (point) => point.connectionName === targetConnectionName,
              ),
              portPointsInPairs: node.portPointsInPairs?.filter((pair) =>
                pair.some(
                  (point) => point.connectionName === targetConnectionName,
                ),
              ),
            })),
          nearbyPads: solver.srj.obstacles.filter((obstacle) =>
            ["pcb_port_72", "pcb_port_119"].some((portId) =>
              obstacle.connectedTo.includes(portId),
            ),
          ),
        }),
      )
    }
    console.info(
      JSON.stringify({
        dataset: "srj19",
        sampleNumber: 26,
        stage,
        elapsedTimeMs,
        copperDrcIssueCount: errors.length,
        copperErrors: errorsWithCenters,
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
    // Exclude diagnostic DRC and logging from solver-stage timings.
    stageElapsedTimeMs += performance.now() - stepStartedAt
    if (solver.getCurrentPhase() !== stage) {
      if (stageOutputs[stage]) {
        // Capture accepted copper before a downstream stage can mutate it.
        logStageCopper(stage, stageOutputs[stage]!(), stageElapsedTimeMs)
      }
      stageElapsedTimeMs = 0
    }
  }

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  console.info(
    JSON.stringify({
      dataset: "srj19",
      sampleNumber: 26,
      stage: "final",
      errors,
    }),
  )
  expect(errors).toHaveLength(0)
})
