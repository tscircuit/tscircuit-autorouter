import { expect, test } from "bun:test"
import { SingleTransitionIntraNodeSolver } from "lib/solvers/HighDensitySolver/SingleTransitionIntraNodeSolver"
import type { SingleTransitionBoardContext } from "lib/solvers/HighDensitySolver/findSingleTransitionVia"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import fixture from "../fixtures/sample24-constructive-transition-c74.json"

test("constructive transition preserves valid nominal output and checks wires, ownership and board copper", (): void => {
  const params = { nodeWithPortPoints: structuredClone(fixture.node), viaDiameter: 0.3, traceThickness: 0.1 }
  const context: SingleTransitionBoardContext = { obstacles: [], layerCount: 8, allowBlindAndBuriedVias: false,
    viaToPadClearance: 0.15, traceToPadClearance: 0.15, boardGeometry: fixture.boardGeometry, coordinateScale: 1 }
  const legacy = new SingleTransitionIntraNodeSolver(params).solvedRoutes
  expect(new SingleTransitionIntraNodeSolver({ ...params, boardContext: context }).solvedRoutes).toEqual(legacy)
  expect(new SingleTransitionIntraNodeSolver({ ...params, boardContext: { ...context, obstacles: [fixture.obstacles[0]!], allowBlindAndBuriedVias: true } }).solvedRoutes).toEqual(legacy)
  const ownNode = structuredClone(params.nodeWithPortPoints)
  for (const port of ownNode.portPoints) { port.connectionName = "net_mst0"; port.rootConnectionName = "net" }
  ownNode.portPointsInPairs = [[ownNode.portPoints[0]!, ownNode.portPoints[1]!]]
  const own = { ...fixture.obstacles[0]!, connectedTo: ["net"] }
  const ownParams = { ...params, nodeWithPortPoints: ownNode }
  expect(new SingleTransitionIntraNodeSolver({ ...ownParams, boardContext: { ...context, obstacles: [own] } }).solvedRoutes)
    .toEqual(new SingleTransitionIntraNodeSolver(ownParams).solvedRoutes)

  const node: NodeWithPortPoints = { capacityMeshNodeId: "wire-control", center: { x: 2, y: 0 }, width: 4, height: 2,
    availableZ: [0, 4], portPoints: [{ connectionName: "A", x: 0, y: 0, z: 0 }, { connectionName: "A", x: 4, y: 0, z: 4 }] }
  const wireBlocker = { type: "rect" as const, center: { x: 1, y: 0 }, width: 0.2, height: 0.2, layers: ["top"], connectedTo: [] }
  const wire = new SingleTransitionIntraNodeSolver({ nodeWithPortPoints: node, viaDiameter: 0.3, traceThickness: 0.1,
    boardContext: { ...context, boardGeometry: undefined, obstacles: [wireBlocker] } })
  expect(wire.solved).toBe(true)
  expect(wire.solvedRoutes[0]!.vias[0]!.x).toBeLessThan(0.6)
  expect(wire.solvedRoutes[0]!.vias[0]!.y).toBe(0)
  // A pad on an unrelated wire layer is ignored for wire clearance, while a
  // through via still sees it. Explicit blind routing avoids that layer.
  expect(new SingleTransitionIntraNodeSolver({ nodeWithPortPoints: node, viaDiameter: 0.3, traceThickness: 0.1,
    boardContext: { ...context, boardGeometry: undefined, allowBlindAndBuriedVias: true, obstacles: [{ ...wireBlocker, layers: ["bottom"] }] } }).solvedRoutes)
    .toEqual(new SingleTransitionIntraNodeSolver({ nodeWithPortPoints: node, viaDiameter: 0.3, traceThickness: 0.1 }).solvedRoutes)

  const board = { bounds: { minX: -1, maxX: 5, minY: -1, maxY: 1 },
    outline: [{ x: -1, y: -1 }, { x: 5, y: -1 }, { x: 5, y: 1 }, { x: -1, y: 1 }], minBoardEdgeClearance: 0.05 }
  const impossible = new SingleTransitionIntraNodeSolver({ nodeWithPortPoints: node, viaDiameter: 0.3, traceThickness: 0.1,
    boardContext: { ...context, boardGeometry: board, obstacles: [{ ...wireBlocker, center: node.center, width: 10, height: 10, layers: ["bottom"] }] } })
  expect(impossible.failed).toBe(true)
  expect(impossible.solved).toBe(false)
  expect(impossible.solvedRoutes).toEqual([])
  impossible.step()
  expect(impossible.solved).toBe(false)
  const edgeNode = { ...node, center: { x: 0.1, y: 0 }, width: 0.1,
    portPoints: [{ connectionName: "A", x: 0.1, y: 0, z: 0 }, { connectionName: "A", x: 0.1, y: 0.1, z: 4 }] }
  expect(new SingleTransitionIntraNodeSolver({ nodeWithPortPoints: edgeNode, viaDiameter: 0.3, traceThickness: 0.1,
    boardContext: { ...context, boardGeometry: { ...board, bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
      outline: [{ x: 0, y: -1 }, { x: 4, y: -1 }, { x: 4, y: 1 }, { x: 0, y: 1 }] } } }).failed).toBe(true)
})
