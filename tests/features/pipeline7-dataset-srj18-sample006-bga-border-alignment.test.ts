import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { getPointKey } from "lib/utils/getPointKey"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("pipeline7 dataset-srj18 sample006 routes BGA endpoint with aligned mesh borders", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 6, 0.1)
  const solver = new AutoroutingPipelineSolver7_MultiGraph(scenario, {
    effort: 0.1,
    cacheProvider: null,
  })

  solver.solveUntilPhase("portPointPathingSolver")

  while (
    solver.getCurrentPhase() === "portPointPathingSolver" &&
    !solver.failed &&
    !solver.solved
  ) {
    solver.step()
  }

  const portPointPathingSolver = solver.portPointPathingSolver
  const [params] = portPointPathingSolver!.getConstructorParams()
  const targetRoute = params.connections.find(
    (connection) => connection.connectionId === "source_trace_53",
  )
  const pointPairConnections =
    solver.netToPointPairsSolver?.newConnections ?? []
  const originalSourceTraceConnections = scenario.connections.filter(
    (connection) => connection.name.startsWith("source_trace_"),
  )
  const originalSourceTraceEndpointKeys = new Map<string, string>()
  for (const connection of originalSourceTraceConnections) {
    originalSourceTraceEndpointKeys.set(
      connection.name,
      connection.pointsToConnect.map(getPointKey).sort().join("::"),
    )
  }
  const originalSourceNetNames = new Set(
    scenario.connections
      .filter((connection) => connection.name.startsWith("source_net_"))
      .map((connection) => connection.name),
  )
  const exactSourceTraceRoutes = pointPairConnections.filter((connection) =>
    originalSourceTraceEndpointKeys.has(connection.name),
  )
  const exactSourceNetRoutes = pointPairConnections.filter((connection) =>
    originalSourceNetNames.has(connection.name),
  )
  const sourceTraceEndpointMismatches = exactSourceTraceRoutes.filter(
    (connection) =>
      originalSourceTraceEndpointKeys.get(connection.name) !==
      connection.pointsToConnect.map(getPointKey).sort().join("::"),
  )

  expect(solver.failed).toBe(false)
  expect(solver.error).toBeNull()
  expect(portPointPathingSolver?.failed).toBe(false)
  expect(portPointPathingSolver?.solved).toBe(true)
  expect(targetRoute).toBeDefined()
  expect(targetRoute!.startRegion.d._containsObstacle).toBe(true)
  expect(targetRoute!.startRegion.d._containsTarget).toBe(true)
  expect(targetRoute!.startRegion.ports.length).toBeGreaterThan(0)
  expect(pointPairConnections).toHaveLength(79)
  expect(originalSourceTraceConnections).toHaveLength(79)
  expect(exactSourceTraceRoutes).toHaveLength(79)
  expect(sourceTraceEndpointMismatches).toHaveLength(0)
  expect(exactSourceNetRoutes).toHaveLength(0)
  expect(
    portPointPathingSolver?.stats.impossibleSingleLayerCrossingNodeCount ?? 0,
  ).toBe(0)
  expect(
    portPointPathingSolver?.stats.staticallyUnroutableRouteCount ?? 0,
  ).toBe(0)
})
