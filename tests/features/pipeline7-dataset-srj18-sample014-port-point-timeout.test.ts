import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { getPointKey } from "lib/utils/getPointKey"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("pipeline7 dataset-srj18 sample014 preserves source traces and solves port points", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 14)
  const solver = new AutoroutingPipelineSolver7_MultiGraph(scenario, {
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
  const bridgeRoutes = pointPairConnections.filter(
    (connection) =>
      !originalSourceTraceEndpointKeys.has(connection.name) &&
      !originalSourceNetNames.has(connection.name),
  )
  const sourceNet8Routes = pointPairConnections.filter((connection) =>
    connection.mergedConnectionNames?.includes("source_net_8"),
  )

  expect(solver.failed).toBe(false)
  expect(solver.error).toBeNull()
  expect(portPointPathingSolver?.failed).toBe(false)
  expect(portPointPathingSolver?.solved).toBe(true)
  expect(portPointPathingSolver?.error).toBeNull()
  expect(pointPairConnections).toHaveLength(152)
  expect(originalSourceTraceConnections).toHaveLength(135)
  expect(exactSourceTraceRoutes).toHaveLength(135)
  expect(sourceTraceEndpointMismatches).toHaveLength(0)
  expect(exactSourceNetRoutes).toHaveLength(0)
  expect(bridgeRoutes).toHaveLength(17)
  expect(sourceNet8Routes).toHaveLength(50)
  expect(portPointPathingSolver!.iterations).toBeLessThan(2_000_000)
  expect(
    portPointPathingSolver?.stats.impossibleSingleLayerCrossingNodeCount ?? 0,
  ).toBe(0)
  expect(
    portPointPathingSolver?.stats.metadataPortPenaltyCount,
  ).toBeGreaterThan(0)
})
