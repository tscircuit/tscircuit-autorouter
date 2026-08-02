import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type {
  Candidate,
  TinyHyperGraphSolver,
} from "tiny-hypergraph/lib/index"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

const PATHING_ITERATION_LIMIT = 250_000

const summarizePort = (solver: TinyHyperGraphSolver, portId: number) => ({
  portId,
  x: solver.topology.portX[portId],
  y: solver.topology.portY[portId],
  routingCostX:
    solver.topology.portRoutingCostX?.[portId] ??
    solver.topology.portX[portId],
  routingCostY:
    solver.topology.portRoutingCostY?.[portId] ??
    solver.topology.portY[portId],
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

const getDirectedHopCount = (
  solver: TinyHyperGraphSolver,
  routeId: number,
  portId: number,
  nextRegionId: number,
) => {
  const hopCounts =
    solver.problemSetup.directedHopCountToEndByRoute[routeId]
  if (!hopCounts) return undefined

  const incidentRegions = solver.topology.incidentPortRegion[portId] ?? []
  const side =
    incidentRegions[0] === nextRegionId
      ? 0
      : incidentRegions[1] === nextRegionId
        ? 1
        : undefined

  return side === undefined ? undefined : hopCounts[portId * 2 + side]
}

const summarizeCandidate = (
  solver: TinyHyperGraphSolver,
  routeId: number,
  candidate: Candidate,
) => ({
  portId: candidate.portId,
  nextRegionId: candidate.nextRegionId,
  z: solver.topology.portZ[candidate.portId],
  x: solver.topology.portX[candidate.portId],
  y: solver.topology.portY[candidate.portId],
  directedHopCount: getDirectedHopCount(
    solver,
    routeId,
    candidate.portId,
    candidate.nextRegionId,
  ),
  g: candidate.g,
  h: candidate.h,
  f: candidate.f,
})

const getCandidatePathTail = (
  solver: TinyHyperGraphSolver,
  routeId: number,
  candidate: Candidate | undefined,
) => {
  const path = []
  let currentCandidate = candidate

  while (currentCandidate) {
    path.unshift(summarizeCandidate(solver, routeId, currentCandidate))
    currentCandidate = currentCandidate.prevCandidate
  }

  return path.slice(-20)
}

test("diagnose srj24 sample 4 directed-hop pathing stall", async () => {
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

  const tinySolver = pathingSolver.activeSubSolver as TinyHyperGraphSolver
  const routeId = tinySolver.state.currentRouteId!
  const startPortId = tinySolver.problem.routeStartPort[routeId]!
  const endPortId = tinySolver.problem.routeEndPort[routeId]!
  const queuedCandidates = tinySolver.state.candidateQueue
    .toArray()
    .sort((left, right) => left.f - right.f)
  const bestCandidate = queuedCandidates[0]
  const directedHopCounts =
    tinySolver.problemSetup.directedHopCountToEndByRoute[routeId]
  const finiteHopCounts = directedHopCounts
    ? Array.from(directedHopCounts).filter((hopCount) => hopCount >= 0)
    : []
  const committedRouteIds = new Set(
    tinySolver.state.regionSegments.flatMap((segments) =>
      segments.map(([committedRouteId]) => committedRouteId),
    ),
  )

  console.log(
    "srj24 sample 4 directed-hop diagnostic",
    JSON.stringify(
      {
        pathingIterations: pathingSolver.iterations,
        tinyIterations: tinySolver.iterations,
        committedRouteCount: committedRouteIds.size,
        pendingRouteCount: tinySolver.state.unroutedRoutes.length,
        routeId,
        routeNetId: tinySolver.problem.routeNet[routeId],
        routeMetadata: tinySolver.problem.routeMetadata?.[routeId],
        startPortId,
        endPortId,
        startZ: tinySolver.topology.portZ[startPortId],
        endZ: tinySolver.topology.portZ[endPortId],
        startPort: summarizePort(tinySolver, startPortId),
        endPort: summarizePort(tinySolver, endPortId),
        directedHopHeuristicPresent: directedHopCounts !== undefined,
        reachableDirectedHopCount: finiteHopCounts.length,
        minDirectedHopCount:
          finiteHopCounts.length === 0 ? undefined : Math.min(...finiteHopCounts),
        maxDirectedHopCount:
          finiteHopCounts.length === 0 ? undefined : Math.max(...finiteHopCounts),
        candidateQueueLength: queuedCandidates.length,
        bestQueuedCandidates: queuedCandidates
          .slice(0, 20)
          .map((candidate) =>
            summarizeCandidate(tinySolver, routeId, candidate),
          ),
        bestCandidatePathTail: getCandidatePathTail(
          tinySolver,
          routeId,
          bestCandidate,
        ),
      },
      null,
      2,
    ),
  )

  expect(pathingSolver.solved).toBe(true)
})
