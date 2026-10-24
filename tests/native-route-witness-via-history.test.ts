import { expect, test } from "bun:test"
import { NativeRouteWitnessBroker, createNativeWitnessOwnedNode } from "lib/solvers/HighDensitySolver/NativeRouteWitnessBroker"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Single } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

test("native replay rechecks current full-stack vias, future trace veto and linked drill history", () => {
  const A = { x: 1, y: 1, z: 0 }, B = { x: 8, y: 8, z: 1 }
  const node = createNativeWitnessOwnedNode({ capacityMeshNodeId: "via", center: { x: 5, y: 5 }, width: 10, height: 10,
    availableZ: [0, 1], portPoints: [{ ...A, connectionName: "wire", rootConnectionName: "root" },
      { ...B, connectionName: "wire", rootConnectionName: "root" }] })
  const opts: ConstructorParameters<typeof Single>[0] = { connectionName: "wire", rootConnectionName: "root", regionId: "via",
    minDistBetweenEnteringPoints: 0.2, bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10 }, A, B,
    traceThickness: 0.15, viaDiameter: 0.3, obstacleMargin: 0.1, layerCount: 2, availableZ: [0, 1],
    captureSearchDebug: false, obstacleRoutes: [],
    futureConnections: [{ connectionName: "far", points: [{ x: 1, y: 9, z: 0 }, { x: 9, y: 9, z: 0 }] }] }
  const broker = new NativeRouteWitnessBroker(node)
  const source = new Single(opts)
  broker.lookup(source)
  source.solve()
  expect(source.solved).toBe(true)
  expect(source.solvedPath!.vias.length).toBeGreaterThan(0)
  broker.record(source)
  const route = broker.lookup(new Single(opts)).route!
  expect(route).toEqual(source.solvedPath!)
  const via = route.vias[0]!
  const future = new Single({ ...opts, futureConnections: [{ connectionName: "foreign-future",
    points: [{ x: via.x - 0.5, y: via.y, z: 0 }, { x: via.x + 0.5, y: via.y, z: 0 }] }] })
  expect(broker.lookup(future).route).toBeNull()
  const occupied = new Single({ ...opts, obstacleRoutes: [{ connectionName: "foreign-via",
    traceThickness: 0.15, viaDiameter: 0.3, route: [{ ...via, z: 0 }, { ...via, z: 1 }], vias: [{ ...via }] }] })
  expect(broker.lookup(occupied).route).toBeNull()
  const historyChecker = new Single(opts)
  let viaCalls = 0
  const original = historyChecker.isNodeTooCloseToObstacle.bind(historyChecker)
  historyChecker.isNodeTooCloseToObstacle = (candidate, margin, isVia, query): boolean => {
    if (isVia) {
      viaCalls++
      expect(candidate.parent).not.toBeNull()
      expect(historyChecker.getNodePath(candidate).length).toBeGreaterThan(2)
    }
    return original(candidate, margin, isVia, query)
  }
  expect(broker.lookup(historyChecker).route).toEqual(route)
  expect(viaCalls).toBe(route.vias.length)
})
