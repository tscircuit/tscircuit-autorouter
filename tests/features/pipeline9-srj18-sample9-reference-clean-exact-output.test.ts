import { expect, test } from "bun:test"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getBoundsFromNodeWithPortPoints } from "lib/utils/getBoundsFromNodeWithPortPoints"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

const forceCounterNames = [
  "forceNoMotionCount",
  "forceAnchorRejectedCount",
  "forceGeometryRejectedCount",
  "forceCandidateAttemptCount",
  "seamForceCandidateAttemptCount",
  "acceptedForceRepairCount",
  "acceptedSeamForceRepairCount",
  "acceptedRerouteRepairCount",
] as const

type ForceCounterName = (typeof forceCounterNames)[number]
type DiagnosticBounds = ReturnType<typeof getBoundsFromNodeWithPortPoints>

const doDiagnosticBoundsOverlap = (
  first: DiagnosticBounds,
  second: DiagnosticBounds,
): boolean => {
  return (
    first.minX <= second.maxX &&
    first.maxX >= second.minX &&
    first.minY <= second.maxY &&
    first.maxY >= second.minY
  )
}

test("Pipeline9 preserves SRJ18 sample 9's reference-clean exact output", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 9)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )
  const targetConnectionNames = new Set([
    "source_trace_21__source_net_21_mst1",
    "source_trace_36__source_net_36_mst57",
  ])
  const forceCountersByNode = new Map<string, Map<ForceCounterName, number>>()
  const affectedNodeIds = new Set<string>()

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
  while (!solver.solved && !solver.failed) {
    const stage = solver.getCurrentPhase()
    const activeRepairNodeId =
      stage === "highDensityDrcRepairSolver"
        ? solver.highDensityDrcRepairSolver?.activeNode?.capacityMeshNodeId
        : undefined
    const forceCountersBefore = new Map<ForceCounterName, number>()
    if (activeRepairNodeId !== undefined) {
      for (const name of forceCounterNames) {
        forceCountersBefore.set(
          name,
          Number(solver.highDensityDrcRepairSolver!.stats[name]),
        )
      }
    }
    solver.step()
    if (activeRepairNodeId !== undefined) {
      let counters = forceCountersByNode.get(activeRepairNodeId)
      if (counters === undefined) {
        counters = new Map<ForceCounterName, number>()
        forceCountersByNode.set(activeRepairNodeId, counters)
      }
      for (const name of forceCounterNames) {
        const delta =
          Number(solver.highDensityDrcRepairSolver!.stats[name]) -
          forceCountersBefore.get(name)!
        counters.set(name, (counters.get(name) ?? 0) + delta)
      }
    }
    if (solver.getCurrentPhase() === stage || !stageOutputs[stage]) continue
    const hdRoutes = stageOutputs[stage]!()
    const routedTraces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
      connections: solver.netToPointPairsSolver!.newConnections,
      originalConnections: solver.originalSrj.connections,
      hdRoutes,
      layerCount: solver.srj.layerCount,
      obstacles: solver.srj.obstacles,
      defaultViaHoleDiameter: solver.viaHoleDiameter,
      connMap: solver.connMap,
    })
    const { errorsWithCenters, circuitJson } = evaluateRelaxedDrc({
      inputSrj: scenario,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces,
      drcOptions: { includeTraceContinuity: false, includeBoardEdge: false },
    })
    if (
      stage === "highDensityRepairSolver" ||
      stage === "highDensityDrcRepairSolver" ||
      stage === "highDensityStitchSolver"
    ) {
      const fragmentCounts = new Map<string, number>()
      const indexedRoutes = hdRoutes.map((route, globalRouteIndex) => {
        const fragmentIndex = fragmentCounts.get(route.connectionName) ?? 0
        fragmentCounts.set(route.connectionName, fragmentIndex + 1)
        return {
          globalRouteIndex,
          traceId: `${route.connectionName}_${fragmentIndex}`,
          ...route,
        }
      })
      const targetTraceIds = new Set(
        indexedRoutes
          .filter((route) => targetConnectionNames.has(route.connectionName))
          .map((route) => route.traceId),
      )
      const targetErrors = errorsWithCenters.filter(
        (error) =>
          "pcb_trace_id" in error &&
          targetTraceIds.has(error.pcb_trace_id as string),
      )
      const affectedTraceIds = new Set(
        targetErrors.map((error) =>
          "pcb_trace_id" in error ? error.pcb_trace_id : undefined,
        ),
      )
      for (const route of indexedRoutes) {
        if (affectedTraceIds.has(route.traceId) && route.regionId) {
          affectedNodeIds.add(route.regionId)
        }
      }
      const nodes = solver.highDensityNodePortPoints.filter((node) =>
        affectedNodeIds.has(node.capacityMeshNodeId),
      )
      const nativeBounds = nodes.map(getBoundsFromNodeWithPortPoints)
      const nearbyCopper = indexedRoutes.flatMap((route) => {
        // Diagnostic selection includes copper radius and relaxed clearance.
        const margin =
          Math.max(route.traceThickness / 2, route.viaDiameter / 2) + 0.1
        const segments = route.route.flatMap((start, segmentIndex) => {
          const end = route.route[segmentIndex + 1]
          if (!end) return []
          const bounds = {
            minX: Math.min(start.x, end.x) - margin,
            maxX: Math.max(start.x, end.x) + margin,
            minY: Math.min(start.y, end.y) - margin,
            maxY: Math.max(start.y, end.y) + margin,
          }
          return nativeBounds.some((nodeBounds) =>
            doDiagnosticBoundsOverlap(bounds, nodeBounds),
          )
            ? [{ segmentIndex, start, end }]
            : []
        })
        if (segments.length === 0) return []
        return [
          {
            traceId: route.traceId,
            globalRouteIndex: route.globalRouteIndex,
            connectionName: route.connectionName,
            rootConnectionName: route.rootConnectionName,
            regionId: route.regionId,
            traceThickness: route.traceThickness,
            viaDiameter: route.viaDiameter,
            segments,
            vias: route.vias,
          },
        ]
      })
      const targetViaIds = new Set(
        targetErrors.flatMap((error) =>
          "pcb_via_id" in error ? [error.pcb_via_id] : [],
        ),
      )
      const targetVias = circuitJson.flatMap((element) => {
        if (
          element.type !== "pcb_via" ||
          !targetViaIds.has(element.pcb_via_id)
        ) {
          return []
        }
        return [
          {
            ...element,
            ownerTraces: routedTraces.filter((trace) =>
              trace.route.some(
                (point) =>
                  point.route_type === "via" &&
                  point.x === element.x &&
                  point.y === element.y,
              ),
            ),
          },
        ]
      })
      const targetPadIds = new Set(
        targetErrors.flatMap((error) =>
          "pcb_pad_id" in error ? [error.pcb_pad_id] : [],
        ),
      )
      console.info(
        JSON.stringify({
          dataset: "srj18",
          sampleNumber: 9,
          stage,
          diagnostic: "persistent-hd-violation-geometry",
          targetErrors,
          targetVias,
          targetPads: circuitJson.filter(
            (element) =>
              (element.type === "pcb_smtpad" &&
                targetPadIds.has(element.pcb_smtpad_id)) ||
              (element.type === "pcb_plated_hole" &&
                targetPadIds.has(element.pcb_plated_hole_id)),
          ),
          hdRoutes: indexedRoutes.filter((route) =>
            targetConnectionNames.has(route.connectionName),
          ),
          nodes: nodes.map((node) => ({
            ...node,
            nativeBounds: getBoundsFromNodeWithPortPoints(node),
            observedForceCounters: Object.fromEntries(
              forceCountersByNode.get(node.capacityMeshNodeId) ?? [],
            ),
          })),
          nearbyCopper,
          nearbyPads: solver.srj.obstacles.filter((obstacle) => {
            const radius = Math.hypot(obstacle.width, obstacle.height) / 2
            const bounds = {
              minX: obstacle.center.x - radius - 0.1,
              maxX: obstacle.center.x + radius + 0.1,
              minY: obstacle.center.y - radius - 0.1,
              maxY: obstacle.center.y + radius + 0.1,
            }
            return nativeBounds.some((nodeBounds) =>
              doDiagnosticBoundsOverlap(bounds, nodeBounds),
            )
          }),
        }),
      )
    }
    console.info(
      JSON.stringify({
        dataset: "srj18",
        sampleNumber: 9,
        stage,
        copperErrors: errorsWithCenters,
        highDensityStats:
          stage === "highDensityDrcRepairSolver"
            ? solver.highDensityDrcRepairSolver!.stats
            : undefined,
      }),
    )
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
      dataset: "srj18",
      sampleNumber: 9,
      stage: "final",
      errors,
    }),
  )
  // Check the actual final copper before asserting the internal repair path.
  expect(errors).toHaveLength(0)
  const repairStats = solver.pipeline9JointDrcRepairSolver?.stats
  expect(Number(repairStats?.finalDrcIssueCount)).toBeGreaterThan(0)
  expect(repairStats).toMatchObject({
    postExactPrecisionPassAttempted: true,
    postExactReferenceValidationAttempted: true,
    postExactReferenceValidationSkippedForIndexedIssueCount: false,
    postExactReferenceDrcIssueCount: 0,
    postExactReferenceAccepted: true,
    terminalEscapeSkippedForIndexedIssueCount: false,
    terminalEscapeCandidateCount: 0,
    terminalEscapeAcceptedCount: 0,
    regionalB01RepairAttempted: false,
    regionalB01RepairCandidateSearchCount: 0,
  })
})
