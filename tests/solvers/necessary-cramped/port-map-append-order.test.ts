import { expect, test } from "bun:test"
import { MultiTargetNecessaryCrampedPortPointSolver } from "lib/solvers/NecessaryCrampedPortPointSolver/MultiTargetNecessaryCrampedPortPointSolver"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"
import type {
  SegmentPortPoint,
  SharedEdgeSegment,
} from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"

function makeNodes(): CapacityMeshNode[] {
  return ["central", "other", "edge"].map((id, index) => ({
    capacityMeshNodeId: id,
    center: { x: index, y: 0 },
    width: 1,
    height: 1,
    availableZ: [0],
    layer: "top",
    _containsObstacle: false,
    _connectedTo: [],
  })) as CapacityMeshNode[]
}

function makePort(id: string, nodeIds: string[]): SegmentPortPoint {
  return {
    segmentPortPointId: id,
    nodeIds,
    x: 0,
    y: 0,
    availableZ: [0],
    cramped: false,
    connectionName: null,
  } as SegmentPortPoint
}

function makeSolver(sharedEdgeSegments: SharedEdgeSegment[]) {
  const solver = new MultiTargetNecessaryCrampedPortPointSolver({
    sharedEdgeSegments,
    capacityMeshNodes: makeNodes(),
    simpleRouteJson: {
      connections: [],
      layerCount: 2,
      obstacles: [],
      minTraceWidth: 0.1,
      bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
    } as SimpleRouteJson,
  })
  const map = (
    solver as unknown as {
      mapOfCapacityMeshNodeIdToSegmentPortPoints: Map<
        string,
        SegmentPortPoint[]
      >
    }
  ).mapOfCapacityMeshNodeIdToSegmentPortPoints
  return { solver, map }
}

test("cramped node port index preserves insertion order and original port identity across segments", () => {
  const a = makePort("a", ["central", "other"])
  const b = makePort("b", ["central", "edge"])
  const c = makePort("c", ["other", "edge"])
  const d = makePort("d", ["central", "edge"])
  const segments = [
    { portPoints: [a, b] },
    { portPoints: [c, d, a] },
  ] as unknown as SharedEdgeSegment[]
  const { solver, map } = makeSolver(segments)
  expect(map.get("central")).toEqual([a, b, d, a])
  expect(map.get("other")).toEqual([a, c, a])
  expect(map.get("edge")).toEqual([b, c, d])
  expect(map.get("central")![0]).toBe(a)
  expect(map.get("central")![3]).toBe(a)
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
})

test("cramped port index keeps the full dense node fanout without duplicate loss", () => {
  const ports = Array.from({ length: 7500 }, (_, index) =>
    makePort(`dense-${index}`, ["central", "other"]),
  )
  const { map } = makeSolver([
    { portPoints: ports },
  ] as unknown as SharedEdgeSegment[])
  for (const nodeId of ["central", "other"]) {
    const result = map.get(nodeId)!
    expect(result.length).toBe(ports.length)
    expect(result[0]).toBe(ports[0])
    expect(result[1500]).toBe(ports[1500])
    expect(result[7499]).toBe(ports[7499])
  }
})

test("cramped port index rejects nonexisting capacity nodes before indexing", () => {
  const malformed = makePort("missing", ["central", "missing-node"])
  expect(() =>
    makeSolver([{ portPoints: [malformed] }] as unknown as SharedEdgeSegment[]),
  ).toThrow("Could not find capacity mesh node for id missing-node")
})
