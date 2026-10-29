import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9JointLayerAssignmentSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointLayerAssignmentSolver"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { evaluateJointLayerFixture } from "tests/fixtures/joint-layer-assignment"

export const createJointLayerCacheFixture = (blind: boolean): {
  routes: HighDensityRoute[]; srj: SimpleRouteJson; connMap: ConnectivityMap
} => {
  const template = [
    [-4, 0], [-3, 0], [-3, 1], [-1, 1], [-1, 0],
    [1, 0], [1, 1], [3, 1], [3, 0], [4, 0],
  ]
  const routes: HighDensityRoute[] = Array.from({ length: 6 }, (_, index) => ({
    connectionName: `cache_net_${index}`, rootConnectionName: index === 4 ? "shared_root" : undefined,
    traceThickness: 0.15, viaDiameter: 0.4,
    route: template.map(([x, z], pointIndex) => ({ x, y: index * 0.52, z,
      traceThickness: 0.14 + (pointIndex % 3) * 0.02,
      ...([0, template.length - 1].includes(pointIndex)
        ? { pcb_port_id: `cache_port_${index}_${pointIndex}` } : {}),
    })),
    vias: [-3, -1, 1, 3].map((x) => ({ x, y: index * 0.52 })),
  }))
  routes[0].rootConnectionName = "shared_root"
  const srj: SimpleRouteJson = {
    layerCount: 2, allowBlindAndBuriedVias: blind,
    minTraceWidth: 0.15, minViaDiameter: 0.4, minViaHoleDiameter: 0.2,
    minTraceToPadEdgeClearance: 0.1, minViaEdgeToPadEdgeClearance: 0.1,
    bounds: { minX: -5, maxX: 5, minY: -1, maxY: 4 },
    connections: routes.map((route) => ({ name: route.connectionName,
      pointsToConnect: [route.route[0], route.route.at(-1)!].map((point) => ({
        x: point.x, y: point.y, layer: "top", pcb_port_id: point.pcb_port_id,
      })),
    })),
    obstacles: routes.flatMap((route) => [route.route[0], route.route.at(-1)!].map((point) => ({
      type: "rect" as const, obstacleId: point.pcb_port_id,
      center: { x: point.x, y: point.y }, width: 0.4, height: 0.4,
      layers: ["top"], connectedTo: [route.connectionName, point.pcb_port_id!],
    }))),
  }
  srj.obstacles.push({ type: "rect", shape: "circle", obstacleId: "static_variant_blocker",
    center: { x: -2, y: 0 }, width: 0.1, height: 0.1,
    layers: ["top"], connectedTo: ["foreign"] })
  const connMap = new ConnectivityMap(Object.fromEntries(routes.map((route) =>
    [route.connectionName, [route.connectionName, ...(route.rootConnectionName ? [route.rootConnectionName] : [])]])))
  return { routes, srj, connMap }
}

export const runJointLayerCacheFixture = (
  fixture: ReturnType<typeof createJointLayerCacheFixture>,
  uncached: boolean,
  maxSearchStates: number,
): { output: HighDensityRoute[]; stats: Record<string, unknown>; evaluations: string[] } => {
  const evaluations: string[] = []
  const solver = new Pipeline9JointLayerAssignmentSolver({ routes: fixture.routes,
    fixedRoutes: [], layerCount: fixture.srj.layerCount,
    allowBlindAndBuriedVias: fixture.srj.allowBlindAndBuriedVias,
    connMap: fixture.connMap, obstacles: fixture.srj.obstacles, clearance: 0.1,
    maxSearchStates, evaluate: (routes) => {
      const result = evaluateJointLayerFixture(fixture.srj, routes)
      evaluations.push(JSON.stringify({ routes, result }))
      return result
    },
  })
  if (uncached) {
    const internals = solver as unknown as {
      variantCache: Map<string, unknown>; pairConflictCache: Map<string, unknown>
    }
    internals.variantCache.get = (): undefined => undefined
    internals.pairConflictCache.get = (): undefined => undefined
  }
  solver.solve()
  if (!solver.solved || solver.failed) throw new Error("Synthetic cache fixture failed")
  return { output: solver.getOutput(), stats: { ...solver.stats }, evaluations }
}
