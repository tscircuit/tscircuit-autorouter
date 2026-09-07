import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { ChangedPreloadedTraceSection } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { TinyHyperGraphSolver } from "tiny-hypergraph/lib/index"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

type NodeSnapshot = Pick<
  NodeWithPortPoints,
  "capacityMeshNodeId" | "center" | "width" | "height" | "availableZ"
> & {
  portPointsInPairs: NodeWithPortPoints["portPointsInPairs"]
}
type RouteSnapshot = Pick<
  HighDensityRoute,
  | "connectionName"
  | "rootConnectionName"
  | "regionId"
  | "startPcbPortId"
  | "endPcbPortId"
  | "vias"
> & {
  pointCount: number
  start: HighDensityRoute["route"][number] | undefined
  end: HighDensityRoute["route"][number] | undefined
}
type StageSnapshot = {
  stage: string
  nodes?: NodeSnapshot[]
  routes?: RouteSnapshot[]
}
type TinyDiagnosticAccess = {
  tinyPipelineSolver: {
    getSolvedTinySolver: () => TinyHyperGraphSolver
  }
}
type ObservedStep =
  AutoroutingPipelineSolver9_PreloadedTraceGraph["pipelineDef"][number]
type CallbackSnapshot = {
  step: ObservedStep
  onSolved: ObservedStep["onSolved"]
}

test("Pipeline9 preserves SRJ23 sample45's completed DRC-clean preloaded path", async (): Promise<void> => {
  // Main completes this benchmark ordinal with zero relaxed DRC findings.
  const { scenario } = await loadScenarioBySampleNumber("srj23", 45)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )

  let changedSections: ChangedPreloadedTraceSection[] = []
  const stageSnapshots: StageSnapshot[] = []
  const captureErrors: string[] = []
  const monitoredStages = new Set([
    "portPointPathingSolver",
    "uniformPortDistributionSolver",
    "highDensityRouteSolver",
    "highDensityForceImproveSolver",
    "highDensityRepairSolver",
    "highDensityDrcRepairSolver",
  ])
  const originalCallbacks = solver.pipelineDef
    .filter((step): boolean => monitoredStages.has(step.solverName))
    .map((step): CallbackSnapshot => ({ step, onSolved: step.onSolved }))

  // Snapshot stage boundaries while their output is current; later repair
  // stages must not obscure whether a graph port or a splice endpoint moved.
  for (const { step, onSolved } of originalCallbacks) {
    step.onSolved = (instance): void => {
      onSolved?.(instance)
      try {
        let nodes: NodeWithPortPoints[] | undefined
        let routes: HighDensityRoute[] | undefined
        if (step.solverName === "portPointPathingSolver") {
          const output = instance.portPointPathingSolver!.getOutput()
          changedSections = structuredClone(
            output.changedPreloadedTraceSections,
          )
          nodes = output.nodesWithPortPoints
        } else if (step.solverName === "uniformPortDistributionSolver") {
          nodes = instance.uniformPortDistributionSolver!.getOutput()
        } else if (step.solverName === "highDensityRouteSolver") {
          routes = instance.highDensityRouteSolver!.routes
        } else if (step.solverName === "highDensityForceImproveSolver") {
          routes = instance.highDensityForceImproveSolver!.getOutput()
        } else if (step.solverName === "highDensityRepairSolver") {
          routes = instance.highDensityRepairSolver!.getOutput()
        } else if (step.solverName === "highDensityDrcRepairSolver") {
          routes = instance.highDensityDrcRepairSolver!.getOutput()
        }
        const sectionNames = new Set(
          changedSections.map((section): string => section.connectionName),
        )
        stageSnapshots.push(
          structuredClone({
            stage: step.solverName,
            nodes: nodes
              ?.filter((node): boolean =>
                node.portPoints.some((point): boolean =>
                  sectionNames.has(point.connectionName),
                ),
              )
              .map(
                (node): NodeSnapshot => ({
                  capacityMeshNodeId: node.capacityMeshNodeId,
                  center: node.center,
                  width: node.width,
                  height: node.height,
                  availableZ: node.availableZ,
                  portPointsInPairs: node.portPointsInPairs?.filter(
                    (pair): boolean =>
                      pair.some((point): boolean =>
                        sectionNames.has(point.connectionName),
                      ),
                  ),
                }),
              ),
            routes: routes
              ?.filter((route): boolean =>
                sectionNames.has(route.connectionName),
              )
              .map(
                (route): RouteSnapshot => ({
                  connectionName: route.connectionName,
                  rootConnectionName: route.rootConnectionName,
                  regionId: route.regionId,
                  startPcbPortId: route.startPcbPortId,
                  endPcbPortId: route.endPcbPortId,
                  pointCount: route.route.length,
                  start: route.route[0],
                  end: route.route.at(-1),
                  vias: route.vias,
                }),
              ),
          }),
        )
      } catch (error) {
        captureErrors.push(
          `${step.solverName}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }

  let solveError: unknown
  try {
    solver.solve()
  } catch (error) {
    solveError = error
    throw error
  } finally {
    for (const { step, onSolved } of originalCallbacks) {
      step.onSolved = onSolved
    }
    if (solveError !== undefined || !solver.solved) {
      try {
        const errorMessage =
          solveError instanceof Error
            ? solveError.message
            : String(solveError ?? solver.error)
        const matchedSections = changedSections.filter((section): boolean =>
          errorMessage.includes(JSON.stringify(section.connectionName)),
        )
        const reportedSections =
          matchedSections.length > 0 ? matchedSections : changedSections
        const pathing = solver.portPointPathingSolver
        let tiny: TinyHyperGraphSolver | undefined
        if (pathing?.solved) {
          try {
            tiny = (
              pathing as unknown as TinyDiagnosticAccess
            ).tinyPipelineSolver.getSolvedTinySolver()
          } catch (error) {
            captureErrors.push(
              `Tiny solved state: ${error instanceof Error ? error.message : String(error)}`,
            )
          }
        }
        console.error(
          "SRJ23_SAMPLE45_BOUNDARY_FAILURE",
          JSON.stringify({
            phase: solver.getCurrentPhase(),
            error: errorMessage.split(": {")[0],
            changedSectionCount: changedSections.length,
            reportedSectionCount: reportedSections.length,
            tinySolvedStateAvailable: tiny !== undefined,
            captureErrors,
          }),
        )

        for (const section of reportedSections) {
          const originalTrace = scenario.traces?.find(
            (trace): boolean => trace.pcb_trace_id === section.traceId,
          )
          const routeId = tiny?.problem.routeMetadata?.findIndex(
            (metadata): boolean =>
              metadata?.connectionId === section.connectionName,
          )
          const tinyRoute =
            tiny !== undefined &&
            routeId !== undefined &&
            routeId >= 0 &&
            routeId < tiny.problem.routeCount &&
            routeId < tiny.problem.routeStartPort.length &&
            routeId < tiny.problem.routeEndPort.length
              ? { solver: tiny, routeId }
              : null
          const endpointPortIds = tinyRoute
            ? [
                tinyRoute.solver.problem.routeStartPort[tinyRoute.routeId],
                tinyRoute.solver.problem.routeEndPort[tinyRoute.routeId],
              ]
            : []
          const endpointPorts = endpointPortIds.map(
            (portId): Record<string, unknown> => {
              if (
                !Number.isInteger(portId) ||
                portId < 0 ||
                portId >= tiny!.topology.portCount
              ) {
                return { portId, unavailable: true }
              }
              return {
                portId,
                serializedPortId:
                  tiny!.topology.portMetadata?.[portId]?.serializedPortId,
                point: {
                  x: tiny!.topology.portX[portId],
                  y: tiny!.topology.portY[portId],
                  z: tiny!.topology.portZ[portId],
                },
                incidentRegions: (
                  tiny!.topology.incidentPortRegion[portId] ?? []
                ).map((regionId): Record<string, unknown> => {
                  if (
                    regionId < 0 ||
                    regionId >= tiny!.topology.regionCenterX.length
                  ) {
                    return { regionId, unavailable: true }
                  }
                  const metadata = tiny!.topology.regionMetadata?.[regionId]
                  const originalNode = solver.capacityNodes?.find(
                    (node): boolean =>
                      node.capacityMeshNodeId ===
                      metadata?.capacityMeshNodeId,
                  )
                  return {
                    regionId,
                    serializedRegionId: metadata?.serializedRegionId,
                    capacityMeshNodeId: metadata?.capacityMeshNodeId,
                    center: {
                      x: tiny!.topology.regionCenterX[regionId],
                      y: tiny!.topology.regionCenterY[regionId],
                    },
                    width: tiny!.topology.regionWidth[regionId],
                    height: tiny!.topology.regionHeight[regionId],
                    availableZMask:
                      tiny!.topology.regionAvailableZMask?.[regionId] ?? null,
                    assignedPairs: tiny!.state.regionSegments[
                      regionId
                    ]?.filter(
                      ([assignedRouteId]): boolean =>
                        assignedRouteId === routeId,
                    ),
                    originalNode: originalNode
                      ? {
                          center: originalNode.center,
                          width: originalNode.width,
                          height: originalNode.height,
                          availableZ: originalNode.availableZ,
                        }
                      : null,
                  }
                }),
              }
            },
          )
          console.error(
            "SRJ23_SAMPLE45_BOUNDARY_SECTION",
            JSON.stringify({
              section,
              originalConnectionName: originalTrace?.connection_name,
              originalBoundarySegments: [
                section.startRoutePosition,
                section.endRoutePosition,
              ].map((routePosition): Record<string, unknown> => {
                const pointIndex = Math.floor(routePosition)
                return {
                  routePosition,
                  pointIndex,
                  previous: originalTrace?.route[pointIndex - 1] ?? null,
                  start: originalTrace?.route[pointIndex] ?? null,
                  end: originalTrace?.route[pointIndex + 1] ?? null,
                }
              }),
              tinyRouteId: tinyRoute?.routeId ?? null,
              tinyRouteMetadata: tinyRoute
                ? tinyRoute.solver.problem.routeMetadata?.[tinyRoute.routeId]
                : null,
              endpointPorts,
              stages: stageSnapshots.map((snapshot): StageSnapshot => ({
                stage: snapshot.stage,
                nodes: snapshot.nodes
                  ?.filter((node): boolean =>
                    node.portPointsInPairs?.some((pair): boolean =>
                      pair.some((point): boolean =>
                        point.connectionName === section.connectionName,
                      ),
                    ) === true,
                  )
                  .map((node): NodeSnapshot => ({
                    ...node,
                    portPointsInPairs: node.portPointsInPairs?.filter(
                      (pair): boolean =>
                        pair.some((point): boolean =>
                          point.connectionName === section.connectionName,
                        ),
                    ),
                  })),
                routes: snapshot.routes?.filter(
                  (route): boolean =>
                    route.connectionName === section.connectionName,
                ),
              })),
            }),
          )
        }
      } catch (error) {
        // Diagnostic access must not replace the original solve failure.
        console.error(
          "SRJ23_SAMPLE45_BOUNDARY_DIAGNOSTIC_ERROR",
          error instanceof Error ? error.message : String(error),
        )
      }
    }
  }

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const finalDrc = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  expect(finalDrc.errors).toEqual([])
})
