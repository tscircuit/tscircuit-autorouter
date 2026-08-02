import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { ConnectionPoint } from "lib/types"
import { getConnectionPointLayers } from "lib/utils/connection-point-utils"
import type { TinyHyperGraphSolver } from "tiny-hypergraph/lib/index"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

const pointsShareLayer = (a: ConnectionPoint, b: ConnectionPoint) => {
  const bLayers = new Set(getConnectionPointLayers(b))
  return getConnectionPointLayers(a).some((layer) => bLayers.has(layer))
}

test("diagnose srj24 sample 4 after layer-aware point pairing", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj24", 4, 1)
  const solver = new AutoroutingPipelineSolver7_MultiGraph(scenario, {
    effort: 1,
    cacheProvider: null,
  })

  solver.solveUntilPhase("portPointPathingSolver")
  solver.step()

  const pointPairs = solver.netToPointPairsSolver!.newConnections
  const crossLayerPairs = pointPairs.filter(
    (connection) =>
      connection.pointsToConnect.length === 2 &&
      !pointsShareLayer(
        connection.pointsToConnect[0]!,
        connection.pointsToConnect[1]!,
      ),
  )

  const pathingSolver = solver.portPointPathingSolver!
  pathingSolver.MAX_ITERATIONS = 100_000
  while (
    solver.getCurrentPhase() === "portPointPathingSolver" &&
    !solver.failed &&
    !solver.solved
  ) {
    solver.step()
  }

  const tinySolver = pathingSolver.activeSubSolver as TinyHyperGraphSolver
  const currentRouteId = tinySolver.state.currentRouteId
  const startPortId =
    currentRouteId === undefined
      ? undefined
      : tinySolver.problem.routeStartPort[currentRouteId]
  const endPortId =
    currentRouteId === undefined
      ? undefined
      : tinySolver.problem.routeEndPort[currentRouteId]
  const getPort = (portId: number | undefined) =>
    portId === undefined
      ? undefined
      : {
          x: tinySolver.topology.portX[portId],
          y: tinySolver.topology.portY[portId],
          z: tinySolver.topology.portZ[portId],
          serializedPortId:
            tinySolver.topology.portMetadata?.[portId]?.serializedPortId,
        }

  console.log(
    "srj24 sample 4 layer-aware point-pair diagnostic",
    JSON.stringify({
      pointPairCount: pointPairs.length,
      crossLayerPairCount: crossLayerPairs.length,
      crossLayerPairs: crossLayerPairs.slice(0, 20).map((connection) => ({
        name: connection.name,
        points: connection.pointsToConnect.map((point) => ({
          x: point.x,
          y: point.y,
          layers: getConnectionPointLayers(point),
          pcbPortId: point.pcb_port_id,
        })),
      })),
      pathingIterations: pathingSolver.iterations,
      pathingSolved: pathingSolver.solved,
      pathingFailed: pathingSolver.failed,
      currentRouteId,
      currentRouteMetadata:
        currentRouteId === undefined
          ? undefined
          : tinySolver.problem.routeMetadata?.[currentRouteId],
      startPort: getPort(startPortId),
      endPort: getPort(endPortId),
      committedRouteCount: new Set(
        tinySolver.state.regionSegments.flatMap((segments) =>
          segments.map(([routeId]) => routeId),
        ),
      ).size,
      pendingRouteCount: tinySolver.state.unroutedRoutes.length,
      candidateQueueLength: tinySolver.state.candidateQueue.length,
    }),
  )

  expect(pathingSolver.solved).toBe(true)
})
