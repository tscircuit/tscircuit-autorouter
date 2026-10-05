import { expect, test } from "bun:test"
import type {
  SegmentPortPoint,
  SharedEdgeSegment,
} from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { MultiTargetNecessaryCrampedPortPointSolver } from "lib/solvers/NecessaryCrampedPortPointSolver/MultiTargetNecessaryCrampedPortPointSolver"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"

type Point = { x: number; y: number }

function createNode(
  id: string,
  center: Point,
  size: { width: number; height: number },
  containsObstacle: boolean,
): CapacityMeshNode {
  return {
    capacityMeshNodeId: id,
    center,
    width: size.width,
    height: size.height,
    layer: "z0",
    availableZ: [0],
    _containsObstacle: containsObstacle,
  }
}

function createSegment(
  nodeIds: [string, string],
  at: Point,
  cramped: boolean,
): SharedEdgeSegment {
  const portPoint: SegmentPortPoint = {
    segmentPortPointId: `${nodeIds.join("-")}_pp0_z0${cramped ? "_cramped" : ""}`,
    x: at.x,
    y: at.y,
    availableZ: [0],
    nodeIds,
    edgeId: nodeIds.join("-"),
    connectionName: null,
    distToCentermostPortOnZ: 0,
    cramped,
  }
  return {
    edgeId: nodeIds.join("-"),
    nodeIds,
    start: at,
    end: at,
    availableZ: [0],
    portPoints: [portPoint],
  }
}

test("a pad in a closed strip of small free nodes keeps its cramped escapes", (): void => {
  // Pad "pad" opens into a strip of small free nodes a-b-c along a pad row.
  // The strip's only ways out to the open node are cramped, so a two-deep
  // search from the pad finds free nodes but every route out still needs
  // one of the cramped ports.
  const nodes = [
    createNode("pad", { x: 0, y: 0 }, { width: 0.4, height: 0.8 }, true),
    createNode("a", { x: 0.4, y: 0 }, { width: 0.4, height: 0.8 }, false),
    createNode("b", { x: 0.8, y: 0 }, { width: 0.4, height: 0.8 }, false),
    createNode("c", { x: 1.2, y: 0 }, { width: 0.4, height: 0.8 }, false),
    createNode("open", { x: 0.8, y: 1.0 }, { width: 2, height: 1.2 }, false),
  ]
  const sharedEdgeSegments = [
    createSegment(["pad", "a"], { x: 0.2, y: 0 }, false),
    createSegment(["a", "b"], { x: 0.6, y: 0 }, false),
    createSegment(["b", "c"], { x: 1.0, y: 0 }, false),
    createSegment(["a", "open"], { x: 0.4, y: 0.4 }, true),
    createSegment(["b", "open"], { x: 0.8, y: 0.4 }, true),
    createSegment(["c", "open"], { x: 1.2, y: 0.4 }, true),
  ]
  const simpleRouteJson: SimpleRouteJson = {
    layerCount: 1,
    minTraceWidth: 0.1,
    bounds: { minX: -1, maxX: 3, minY: -1, maxY: 3 },
    obstacles: [],
    connections: [
      {
        name: "net1",
        pointsToConnect: [
          { pointId: "pad_port", x: 0, y: 0, layer: "top" },
          { pointId: "far_port", x: 2.5, y: 2.5, layer: "top" },
        ],
      },
    ],
  }

  const solver = new MultiTargetNecessaryCrampedPortPointSolver({
    sharedEdgeSegments,
    preservedSharedEdgeSegments: [],
    capacityMeshNodes: nodes,
    simpleRouteJson,
  })
  solver.solve()

  const keptCrampedPortPoints = solver
    .getOutput()
    .flatMap((segment) => segment.portPoints)
    .filter((portPoint) => portPoint.cramped)

  expect(solver.failed).toBe(false)
  expect(keptCrampedPortPoints.length).toBeGreaterThan(0)
  expect(
    keptCrampedPortPoints.every((portPoint) =>
      portPoint.nodeIds.includes("open"),
    ),
  ).toBe(true)
})
