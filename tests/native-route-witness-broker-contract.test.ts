import { expect, test } from "bun:test"
import { NativeRouteWitnessBroker, createNativeWitnessOwnedNode } from "lib/solvers/HighDensitySolver/NativeRouteWitnessBroker"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Single } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

const A = { x: 1, y: 1, z: 0 }
const B = { x: 8, y: 8, z: 0 }
const opts: ConstructorParameters<typeof Single>[0] = {
  connectionName: "wire", rootConnectionName: "root", regionId: "owned", minDistBetweenEnteringPoints: 0.2,
  bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10 }, A, B, traceThickness: 0.15, viaDiameter: 0.3,
  obstacleMargin: 0.1, layerCount: 2, availableZ: [0, 1], captureSearchDebug: false, obstacleRoutes: [],
  futureConnections: [{ connectionName: "far", points: [{ x: 1, y: 9, z: 0 }, { x: 9, y: 9, z: 0 }] }],
}

test("native witnesses retain exact current grid, terminal identity, move availability and current constraints", () => {
  const mutableNode = { capacityMeshNodeId: "owned", center: { x: 5, y: 5 }, width: 10, height: 10,
    availableZ: [0, 1], portPoints: [{ ...A, connectionName: "wire", rootConnectionName: "root", pcb_port_id: "A" },
      { ...B, connectionName: "wire", rootConnectionName: "root", pcb_port_id: "B" }] }
  const node = createNativeWitnessOwnedNode(mutableNode)
  const broker = new NativeRouteWitnessBroker(node)
  const source = new Single(opts)
  expect(broker.lookup(source).route).toBeNull()
  source.solve()
  expect(source.solved).toBe(true)
  expect(source.iterations).toBeGreaterThanOrEqual(32)
  expect(broker.record(source)).toBeGreaterThan(0)
  const current = new Single(opts)
  const result = broker.lookup(current)
  expect(result.route).toEqual(source.solvedPath)
  expect(result.workUnits).toBeGreaterThan(0)
  const route = result.route!
  let parent: Parameters<Single["getNeighbors"]>[0] | null = null
  const prefixLength = current.getNodePath(current.candidates.peek()!).length
  for (let index = 0; index < route.route.length; index++) {
    const point = route.route[index]!
    const candidate: Parameters<Single["getNeighbors"]>[0] = { ...point, g: 0, h: 0, f: 0, parent }
    if (index >= prefixLength && index < route.route.length - 1) {
      expect(current.getNeighbors(parent!).some((neighbor) =>
        Object.is(neighbor.x, point.x) && Object.is(neighbor.y, point.y) && neighbor.z === point.z)).toBe(true)
    }
    parent = candidate
  }
  route.route[1]!.x = 1000
  expect(broker.lookup(new Single(opts)).route).toEqual(source.solvedPath)
  mutableNode.portPoints[0]!.pcb_port_id = "edited-outside-owned-scene"
  expect(node.portPoints[0]!.pcb_port_id).toBe("A")
  expect(Object.isFrozen(node.portPoints[0])).toBe(true)
  for (const changes of [
    { rootConnectionName: undefined }, { rootConnectionName: "foreign" }, { connectionName: "foreign" },
    { regionId: "foreign" }, { traceThickness: 0.2 }, { viaDiameter: 0.4 }, { obstacleMargin: 0.2 },
    { layerCount: 4, availableZ: [0, 1, 2, 3] }, { availableZ: [0] },
    { A: { ...A, x: 1.01 } }, { A: B, B: A }, { hyperParameters: { CELL_SIZE_FACTOR: 0.5 } },
  ]) expect(broker.lookup(new Single({ ...opts, ...changes })).route).toBeNull()
  const middle = source.solvedPath!.route[Math.floor(source.solvedPath!.route.length / 2)]!
  expect(broker.lookup(new Single({ ...opts, obstacleRoutes: [{ connectionName: "foreign",
    rootConnectionName: "foreign", traceThickness: 0.15, viaDiameter: 0.3, vias: [],
    route: [{ x: middle.x - 0.5, y: middle.y, z: middle.z }, { x: middle.x + 0.5, y: middle.y, z: middle.z }] }] })).route).toBeNull()
  const special = new Single(opts)
  broker.lookup(special)
  special.solve()
  special.solvedPath!.route[0]!.toNextSegmentType = "through_obstacle"
  const before = broker.diagnostics.stores
  expect(broker.record(special)).toBe(0)
  expect(broker.diagnostics.stores).toBe(before)
  const ownOnlySimple = new Single({ ...opts, futureConnections: [] })
  expect(ownOnlySimple.solved).toBe(true)
  expect(broker.lookup(ownOnlySimple).route).toBeNull()
  expect(broker.record(ownOnlySimple)).toBe(0)
  expect(broker.diagnostics.sceneSerializedBytes).toBeLessThan(2000)
  expect(broker.diagnostics.identityPointReads).toBeGreaterThan(0)
  expect(broker.diagnostics.nativeReplayCalls).toBeGreaterThan(0)
})
