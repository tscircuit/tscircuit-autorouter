import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as SingleRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import { isHighDensityRouteOnAllowedLayers } from "lib/solvers/HighDensitySolver/isHighDensityRouteOnAllowedLayers"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"

test("HD bus wire layers stay per connection while through vias occupy all eight layers", () => {
  // ButterStick source_trace_51's native via coordinate, in a small corridor
  // that forces a layer change. The other connection remains unrestricted.
  const center = { x: -6.180682832766329, y: 1.381546637917522 }
  const connectionName = "source_trace_51_mst1"
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "topology_merge_17168",
    center,
    width: 2,
    height: 2,
    availableZ: [0, 1, 3, 4, 5, 7],
    allowedZByConnectionName: { [connectionName]: [0, 3] },
    portPoints: [
      { connectionName, x: center.x - 0.9, y: center.y, z: 0 },
      { connectionName, x: center.x + 0.9, y: center.y, z: 0 },
      { connectionName: "free", x: center.x - 0.9, y: center.y + 0.5, z: 3 },
      { connectionName: "free", x: center.x + 0.9, y: center.y + 0.5, z: 3 },
    ],
  }
  const intra = new IntraNodeRouteSolver({
    nodeWithPortPoints: node,
    layerCount: 8,
    traceWidth: 0.05,
    viaDiameter: 0.1,
    obstacleMargin: 0.05,
  })
  const opts = intra["getSingleRouteSolverOpts"](intra.unsolvedConnections[0]!)
  const freeOpts = intra["getSingleRouteSolverOpts"](
    intra.unsolvedConnections[1]!,
  )
  expect(opts.availableZ).toEqual([0, 3])
  expect(opts.layerCount).toBe(8)
  expect(freeOpts.availableZ).toEqual(node.availableZ)
  expect(freeOpts.allowedZ).toBeUndefined()
  const barrier: HighDensityRoute = {
    connectionName: "barrier",
    traceThickness: 0.05,
    viaDiameter: 0.1,
    route: [
      { x: center.x, y: center.y - 1, z: 0 },
      { x: center.x, y: center.y + 1, z: 0 },
    ],
    vias: [],
  }
  const solver = new SingleRouteSolver({ ...opts, obstacleRoutes: [barrier] })
  solver.solve()
  expect(solver.solved).toBe(true)
  const route = solver.solvedPath!
  expect(route.allowedZ).toEqual([0, 3])
  expect(route.route.some((point) => point.z === 3)).toBe(true)
  expect(isHighDensityRouteOnAllowedLayers(route)).toBe(true)

  const via = route.vias[0]!
  const viaOnly = {
    ...route,
    route: [
      { ...via, z: 0 },
      { ...via, z: 7 },
    ],
    vias: [via],
  }
  expect(isHighDensityRouteOnAllowedLayers(viaOnly)).toBe(true)
  const checker = new SingleRouteSolver({
    ...opts,
    obstacleRoutes: [
      {
        ...barrier,
        route: [
          { x: via.x - 0.2, y: via.y, z: 7 },
          { x: via.x + 0.2, y: via.y, z: 7 },
        ],
      },
    ],
  })
  const viaNode: Node = {
    ...via,
    z: 3,
    g: 0,
    h: 0,
    f: 0,
    parent: { ...via, z: 0, g: 0, h: 0, f: 0, parent: null },
  }
  expect(checker.isNodeTooCloseToObstacle(viaNode, undefined, false)).toBe(
    false,
  )
  expect(checker.isNodeTooCloseToObstacle(viaNode, undefined, true)).toBe(true)
  const emptyPolicy = new SingleRouteSolver({
    ...opts,
    allowedZ: [],
    availableZ: [],
  })
  emptyPolicy.solve()
  expect(emptyPolicy.failed).toBe(true)
  expect(emptyPolicy.solved).toBe(false)
})
