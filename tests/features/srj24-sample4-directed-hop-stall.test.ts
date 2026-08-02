import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { TinyHyperGraphSolver } from "tiny-hypergraph/lib/index"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

const PATHING_ITERATION_LIMIT = 250_000

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
