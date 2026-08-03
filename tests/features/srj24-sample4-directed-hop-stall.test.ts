import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { getTopologyMergingNodesWithCrossLayerTargetAccess } from "lib/solvers/TopologyMergingSolver/get-cross-layer-target-access"
import { getCapacityMeshNodeBounds } from "lib/solvers/TopologyPlanningSolver/capacity-node-geometry"
import type { CapacityMeshNode } from "lib/types"
import type { TinyHyperGraphSolver } from "tiny-hypergraph/lib/index"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

const END_TARGET_BOUNDS = {
  minX: 1.27 - 0.59 / 2,
  maxX: 1.27 + 0.59 / 2,
  minY: -2.9 - 0.64 / 2,
  maxY: -2.9 + 0.64 / 2,
}

const overlapsEndTarget = (node: CapacityMeshNode): boolean => {
  const bounds = getCapacityMeshNodeBounds(node)
  return !(
    bounds.maxX <= END_TARGET_BOUNDS.minX ||
    bounds.minX >= END_TARGET_BOUNDS.maxX ||
    bounds.maxY <= END_TARGET_BOUNDS.minY ||
    bounds.minY >= END_TARGET_BOUNDS.maxY
  )
}

const summarizeNode = (node: CapacityMeshNode) => ({
  id: node.capacityMeshNodeId,
  bounds: getCapacityMeshNodeBounds(node),
  availableZ: node.availableZ,
  containsObstacle: node._containsObstacle,
  containsTarget: node._containsTarget,
  targetConnectionName: node._targetConnectionName,
  rootAliases: node._connectedTo?.filter((alias) =>
    alias.startsWith("source_"),
  ),
  connectedToCount: node._connectedTo?.length ?? 0,
})

const summarizePort = (solver: TinyHyperGraphSolver, portId: number) => ({
  portId,
  x: solver.topology.portX[portId],
  y: solver.topology.portY[portId],
  z: solver.topology.portZ[portId],
  incidentRegions: solver.topology.incidentPortRegion[portId].map(
    (regionId) => ({
      regionId,
      center: {
        x: solver.topology.regionCenterX[regionId],
        y: solver.topology.regionCenterY[regionId],
      },
      availableZMask: solver.topology.regionAvailableZMask?.[regionId],
      metadata: solver.topology.regionMetadata?.[regionId],
    }),
  ),
  metadata: solver.topology.portMetadata?.[portId],
})

test("diagnose sample 4 topology at the stalled route", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj24", 4, 1)
  const solver = new AutoroutingPipelineSolver7_MultiGraph(scenario, {
    effort: 1,
    cacheProvider: null,
  })

  solver.solveUntilPhase("portPointPathingSolver")
  solver.step()

  const pathingSolver = solver.portPointPathingSolver!

  while (
    solver.getCurrentPhase() === "portPointPathingSolver" &&
    !solver.failed &&
    !solver.solved
  ) {
    solver.step()
  }

  const mergingInput = solver.topologyMergingSolver!.inputProblem
  const preparedAccess = getTopologyMergingNodesWithCrossLayerTargetAccess({
    nodeGroups: mergingInput.nodeGroups,
    viaDiameter: mergingInput.viaDiameter,
  })
  console.error(
    "SRJ24_SAMPLE4_MERGING_INPUT",
    JSON.stringify(
      mergingInput.nodeGroups.flatMap((group) =>
        group.nodes
          .filter(overlapsEndTarget)
          .map((node) => ({
            groupId: group.groupId,
            isComponent: group.isComponent,
            ...summarizeNode(node),
            prepared: preparedAccess.get(node)!.map(summarizeNode),
          })),
      ),
    ),
  )
  console.error(
    "SRJ24_SAMPLE4_MERGING_OUTPUT",
    JSON.stringify(
      solver.topologyMergingSolver!
        .getOutput()
        .filter(overlapsEndTarget)
        .map(summarizeNode),
    ),
  )

  const tinySolver = pathingSolver.activeSubSolver as TinyHyperGraphSolver
  const routeId = tinySolver.state.currentRouteId!
  const startPortId = tinySolver.problem.routeStartPort[routeId]!
  const endPortId = tinySolver.problem.routeEndPort[routeId]!
  const endRegionId = tinySolver.topology.incidentPortRegion[endPortId][0]!
  const endBoundaryPorts = (
    tinySolver.topology.regionIncidentPorts[endRegionId] ?? []
  ).map((portId) => ({
    portId,
    x: tinySolver.topology.portX[portId],
    y: tinySolver.topology.portY[portId],
    z: tinySolver.topology.portZ[portId],
    incidentRegions: tinySolver.topology.incidentPortRegion[portId].map(
      (regionId) => ({
        regionId,
        metadata: tinySolver.topology.regionMetadata?.[regionId],
      }),
    ),
  }))
  const bestCandidates = tinySolver.state.candidateQueue
    .toArray()
    .sort((left, right) => left.f - right.f)
    .slice(0, 5)
    .map((candidate) => ({
      portId: candidate.portId,
      nextRegionId: candidate.nextRegionId,
      x: tinySolver.topology.portX[candidate.portId],
      y: tinySolver.topology.portY[candidate.portId],
      z: tinySolver.topology.portZ[candidate.portId],
      g: candidate.g,
      h: candidate.h,
      f: candidate.f,
    }))
  const committedRouteIds = new Set(
    tinySolver.state.regionSegments.flatMap((segments) =>
      segments.map(([committedRouteId]) => committedRouteId),
    ),
  )

  console.error(
    "SRJ24_SAMPLE4_STATE",
    JSON.stringify({
      pathingIterations: pathingSolver.iterations,
      tinyIterations: tinySolver.iterations,
      committedRouteCount: committedRouteIds.size,
      pendingRouteCount: tinySolver.state.unroutedRoutes.length,
      routeId,
      routeNetId: tinySolver.problem.routeNet[routeId],
      routeMetadata: tinySolver.problem.routeMetadata?.[routeId],
    }),
  )
  console.error(
    "SRJ24_SAMPLE4_START_PORT",
    JSON.stringify(summarizePort(tinySolver, startPortId)),
  )
  console.error(
    "SRJ24_SAMPLE4_END_PORT",
    JSON.stringify(summarizePort(tinySolver, endPortId)),
  )
  console.error(
    "SRJ24_SAMPLE4_END_REGION",
    JSON.stringify({
      endRegionId,
      occupancy: tinySolver.state.regionSegments[endRegionId],
      boundaryPorts: endBoundaryPorts,
    }),
  )
  console.error(
    "SRJ24_SAMPLE4_CANDIDATES",
    JSON.stringify(bestCandidates),
  )

  expect(pathingSolver.solved).toBe(true)
})
