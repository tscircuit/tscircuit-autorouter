import "bun-match-svg"
import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { CapacityMeshNode } from "lib/types"
import type { TinyHyperGraphSolver } from "tiny-hypergraph/lib/index"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

const PATHING_ITERATION_LIMIT = 250_000

const getRegionSummary = (
  solver: TinyHyperGraphSolver,
  regionId: number,
) => {
  const metadata = solver.topology.regionMetadata?.[regionId] as
    | Record<string, unknown>
    | undefined

  return {
    regionId,
    serializedRegionId:
      metadata?.serializedRegionId ?? metadata?.capacityMeshNodeId,
    netId: solver.problem.regionNetId[regionId],
    availableZMask: solver.topology.regionAvailableZMask?.[regionId],
    center: {
      x: solver.topology.regionCenterX[regionId],
      y: solver.topology.regionCenterY[regionId],
    },
    width: solver.topology.regionWidth[regionId],
    height: solver.topology.regionHeight[regionId],
    incidentPortCount:
      solver.topology.regionIncidentPorts[regionId]?.length ?? 0,
    availableZ: metadata?.availableZ,
    containsObstacle: metadata?._containsObstacle,
    containsTarget: metadata?._containsTarget,
    qfpRegionType: metadata?._qfpRegionType,
  }
}

const getPortSummary = (solver: TinyHyperGraphSolver, portId: number) => ({
  portId,
  serializedPortId: solver.topology.portMetadata?.[portId]?.serializedPortId,
  x: solver.topology.portX[portId],
  y: solver.topology.portY[portId],
  z: solver.topology.portZ[portId],
  routingCostX: solver.topology.portRoutingCostX?.[portId],
  routingCostY: solver.topology.portRoutingCostY?.[portId],
  incidentRegions: (solver.topology.incidentPortRegion[portId] ?? []).map(
    (regionId) => getRegionSummary(solver, regionId),
  ),
})

const getDistanceToRegion = (
  solver: TinyHyperGraphSolver,
  regionId: number,
  point: { x: number; y: number },
) => {
  const dx = Math.max(
    Math.abs(solver.topology.regionCenterX[regionId] - point.x) -
      solver.topology.regionWidth[regionId] / 2,
    0,
  )
  const dy = Math.max(
    Math.abs(solver.topology.regionCenterY[regionId] - point.y) -
      solver.topology.regionHeight[regionId] / 2,
    0,
  )
  return Math.hypot(dx, dy)
}

const getCandidatePath = (solver: TinyHyperGraphSolver) => {
  let candidate = solver.state.candidateQueue
    .toArray()
    .sort((left, right) => left.f - right.f)[0]
  const path = []

  while (candidate) {
    path.unshift({
      ...getPortSummary(solver, candidate.portId),
      nextRegion: getRegionSummary(solver, candidate.nextRegionId),
      f: candidate.f,
      g: candidate.g,
      h: candidate.h,
    })
    candidate = candidate.prevCandidate
  }

  return path
}

const getInputNodeSummary = ({
  groupId,
  isComponent,
  node,
  routeRootIds,
}: {
  groupId: string
  isComponent: boolean
  node: CapacityMeshNode
  routeRootIds: readonly string[]
}) => ({
  groupId,
  isComponent,
  capacityMeshNodeId: node.capacityMeshNodeId,
  center: node.center,
  width: node.width,
  height: node.height,
  availableZ: node.availableZ,
  containsObstacle: node._containsObstacle,
  containsTarget: node._containsTarget,
  targetConnectionName: node._targetConnectionName,
  connectedToCount: node._connectedTo?.length ?? 0,
  retainedRouteRoots: routeRootIds.filter(
    (rootId) =>
      node._targetConnectionName === rootId ||
      node._connectedTo?.includes(rootId),
  ),
})

const getDistanceToInputNode = (
  node: CapacityMeshNode,
  point: { x: number; y: number },
) => {
  const dx = Math.max(
    Math.abs(node.center.x - point.x) - node.width / 2,
    0,
  )
  const dy = Math.max(
    Math.abs(node.center.y - point.y) - node.height / 2,
    0,
  )
  return Math.hypot(dx, dy)
}

test("srj24 sample 4 finishes selective-rerip port pathing", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj24", 4, 1)
  const solver = new AutoroutingPipelineSolver7_MultiGraph(scenario, {
    effort: 1,
    cacheProvider: null,
  })

  solver.solveUntilPhase("portPointPathingSolver")
  solver.step()

  const pathingSolver = solver.portPointPathingSolver!
  pathingSolver.MAX_ITERATIONS = PATHING_ITERATION_LIMIT

  while (
    solver.getCurrentPhase() === "portPointPathingSolver" &&
    !solver.failed &&
    !solver.solved
  ) {
    solver.step()
  }

  const pathingStats = pathingSolver.stats as Record<string, unknown>
  const tinySolver = pathingSolver.activeSubSolver as TinyHyperGraphSolver
  const tinyStats = tinySolver.stats as Record<string, unknown>
  const currentRouteId = tinySolver.state.currentRouteId
  const currentRouteMetadata =
    currentRouteId === undefined
      ? undefined
      : tinySolver.problem.routeMetadata?.[currentRouteId]
  const currentRouteRootIds =
    (
      currentRouteMetadata?.simpleRouteConnection as
        | { __rootConnectionNames?: string[] }
        | undefined
    )?.__rootConnectionNames ?? []
  const startPortId =
    currentRouteId === undefined
      ? undefined
      : tinySolver.problem.routeStartPort[currentRouteId]
  const endPortId =
    currentRouteId === undefined
      ? undefined
      : tinySolver.problem.routeEndPort[currentRouteId]
  const endpointMidpoint =
    startPortId === undefined || endPortId === undefined
      ? undefined
      : {
          x:
            (tinySolver.topology.portX[startPortId] +
              tinySolver.topology.portX[endPortId]) /
            2,
          y:
            (tinySolver.topology.portY[startPortId] +
              tinySolver.topology.portY[endPortId]) /
            2,
        }
  const nearbyRegions = endpointMidpoint
    ? Array.from({ length: tinySolver.topology.regionCount }, (_, regionId) =>
        getRegionSummary(tinySolver, regionId),
      )
        .filter(
          ({ regionId }) =>
            getDistanceToRegion(tinySolver, regionId, endpointMidpoint) <= 0.5,
        )
        .sort(
          (left, right) =>
            getDistanceToRegion(tinySolver, left.regionId, endpointMidpoint) -
            getDistanceToRegion(tinySolver, right.regionId, endpointMidpoint),
        )
        .slice(0, 30)
    : []
  const nearbyTopologyInputNodes = endpointMidpoint
    ? solver.topologyMergingSolver!.inputProblem.nodeGroups
        .flatMap((group) =>
          group.nodes.map((node) => ({
            groupId: group.groupId,
            isComponent: group.isComponent,
            node,
          })),
        )
        .filter(
          ({ node }) =>
            getDistanceToInputNode(node, endpointMidpoint) <= 0.5,
        )
        .sort(
          (left, right) =>
            getDistanceToInputNode(left.node, endpointMidpoint) -
            getDistanceToInputNode(right.node, endpointMidpoint),
        )
        .slice(0, 30)
        .map(({ groupId, isComponent, node }) =>
          getInputNodeSummary({
            groupId,
            isComponent,
            node,
            routeRootIds: currentRouteRootIds,
          }),
        )
    : []
  const nearbyMergedNodes = endpointMidpoint
    ? solver
        .topologyMergingSolver!.getOutput()
        .filter(
          (node) => getDistanceToInputNode(node, endpointMidpoint) <= 0.5,
        )
        .sort(
          (left, right) =>
            getDistanceToInputNode(left, endpointMidpoint) -
            getDistanceToInputNode(right, endpointMidpoint),
        )
        .slice(0, 30)
        .map((node) =>
          getInputNodeSummary({
            groupId: "merged",
            isComponent: node._isComponentTopologyNode === true,
            node,
            routeRootIds: currentRouteRootIds,
          }),
        )
    : []
  const committedRouteIds = new Set(
    tinySolver.state.regionSegments.flatMap((segments) =>
      segments.map(([routeId]) => routeId),
    ),
  )
  console.log(
    "srj24 sample 4 selective-rerip summary",
    JSON.stringify({
      regionCount: tinySolver.topology.regionCount,
      portCount: tinySolver.topology.portCount,
      routeCount: tinySolver.problem.routeCount,
      committedRouteCount: committedRouteIds.size,
      pendingRouteCount: tinySolver.state.unroutedRoutes.length,
      currentRouteId,
      candidateQueueLength: tinySolver.state.candidateQueue.length,
      ripCount: tinySolver.state.ripCount,
      selectiveRipCount: tinyStats.selectiveRipCount,
      selectivelyRippedRouteCount: tinyStats.selectivelyRippedRouteCount,
      globalReripCount: tinyStats.globalReripCount,
      globalReripReason: tinyStats.globalReripReason,
      maxFailedOwnerPairCount: tinyStats.maxFailedOwnerPairCount,
      lastFailedRouteId: tinyStats.lastFailedRouteId,
      lastDirectOwnerRouteIds: tinyStats.lastDirectOwnerRouteIds,
      lastRepeatedOwnerRouteIds: tinyStats.lastRepeatedOwnerRouteIds,
      lastAlternateOwnerRouteIds: tinyStats.lastAlternateOwnerRouteIds,
      lastRippedRouteIds: tinyStats.lastRippedRouteIds,
      neverSuccessfullyRoutedRouteCount:
        tinyStats.neverSuccessfullyRoutedRouteCount,
    }),
  )
  console.log(
    "srj24 sample 4 selective-rerip stall",
    JSON.stringify(
      {
        iterations: pathingSolver.iterations,
        solved: pathingSolver.solved,
        failed: pathingSolver.failed,
        error: pathingSolver.error,
        currentStage: pathingStats.currentStage,
        tinyIterations: tinySolver.iterations,
        regionCount: tinySolver.topology.regionCount,
        portCount: tinySolver.topology.portCount,
        routeCount: tinySolver.problem.routeCount,
        committedRouteCount: committedRouteIds.size,
        pendingRouteCount: tinySolver.state.unroutedRoutes.length,
        currentRouteId,
        currentRouteNetId:
          currentRouteId === undefined
            ? undefined
            : tinySolver.problem.routeNet[currentRouteId],
        currentRouteMetadata,
        startPort:
          startPortId === undefined
            ? undefined
            : getPortSummary(tinySolver, startPortId),
        endPort:
          endPortId === undefined
            ? undefined
            : getPortSummary(tinySolver, endPortId),
        endpointMidpoint,
        nearbyTopologyInputNodes,
        nearbyMergedNodes,
        nearbyRegions,
        bestCandidatePathTail: getCandidatePath(tinySolver).slice(-20),
        candidateQueueLength: tinySolver.state.candidateQueue.length,
        ripCount: tinySolver.state.ripCount,
        neverSuccessfullyRoutedRouteCount:
          tinySolver.getNeverSuccessfullyRoutedRoutes().length,
        selectiveRipCount: tinyStats.selectiveRipCount,
        selectivelyRippedRouteCount: tinyStats.selectivelyRippedRouteCount,
        globalReripCount: tinyStats.globalReripCount,
        globalReripReason: tinyStats.globalReripReason,
        maxFailedOwnerPairCount: tinyStats.maxFailedOwnerPairCount,
        lastFailedRouteId: tinyStats.lastFailedRouteId,
        lastDirectOwnerRouteIds: tinyStats.lastDirectOwnerRouteIds,
        lastRepeatedOwnerRouteIds: tinyStats.lastRepeatedOwnerRouteIds,
        lastAlternateOwnerRouteIds: tinyStats.lastAlternateOwnerRouteIds,
        lastRippedRouteIds: tinyStats.lastRippedRouteIds,
      },
      null,
      2,
    ),
  )

  expect(
    getSvgFromGraphicsObject(pathingSolver.visualize()),
  ).toMatchSvgSnapshot(import.meta.path)
  expect(pathingSolver.failed).toBe(false)
  expect(pathingSolver.solved).toBe(true)
})
