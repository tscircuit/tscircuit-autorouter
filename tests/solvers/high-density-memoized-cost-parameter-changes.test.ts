import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

class SparseCostSolver extends FutureCost {
  override getNodeKey(_node: Node): number {
    return -1
  }
}

test("cached costs respond to scalar parameter changes and replacement future point arrays", () => {
  const options = {
    connectionName: "route",
    obstacleRoutes: [],
    minDistBetweenEnteringPoints: 0.15,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    A: { x: -2, y: 0, z: 0 },
    B: { x: 2, y: 0, z: 0 },
    availableZ: [0, 1],
    futureConnections: [
      {
        connectionName: "future",
        points: [
          { x: 0.1, y: 0.1, z: 1 },
          { x: 0.6, y: 0.1, z: 0 },
        ],
      },
    ],
  }
  const mutations: Array<(solver: FutureCost) => void> = [
    (solver) => {
      solver.B.x = 0.08
    },
    (solver) => {
      solver.B.y = 1
    },
    (solver) => {
      solver.B.z = 1
    },
    (solver) => {
      solver.viaDiameter *= 2
    },
    (solver) => {
      solver.FUTURE_CONNECTION_PROXIMITY_VD *= 2
    },
    (solver) => {
      solver.FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR *= 2
    },
    (solver) => {
      solver.FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR *= 2
    },
    (solver) => {
      solver.straightLineDistance *= 2
    },
    (solver) => {
      solver.VIA_PENALTY_FACTOR = 0
    },
    (solver) => {
      solver.cellStep *= 100
    },
    (solver) => {
      solver.MISALIGNED_DIST_PENALTY_FACTOR *= 2
    },
    (solver) => {
      solver.FLIP_TRACE_ALIGNMENT_DIRECTION = true
    },
    (solver) => {
      solver.futureConnectionPoints = [{ x: 0.025, y: 0, z: 0 }]
    },
  ]
  for (const Solver of [FutureCost, SparseCostSolver]) {
    for (const mutate of mutations) {
      const solver = new Solver({ ...options, B: { ...options.B } })
      const storage = solver as unknown as {
        nodeCostParameters: object
        denseNodeCostTerms: unknown[] | null
        nodeCostTermsByGridKey: Map<number, unknown>
      }
      const makeNode = (parentZ: number): Node => ({
        x: 0,
        y: 0,
        z: 0,
        g: 0,
        h: 0,
        f: 0,
        parent: {
          x: -0.05,
          y: -0.025,
          z: parentZ,
          g: 1,
          h: 0,
          f: 0,
          parent: null,
        },
      })
      const before: number[][] = []
      for (const parentZ of [0, 1]) {
        const node = makeNode(parentZ)
        solver.setNodeCosts(node)
        before.push([node.g, node.h, node.f])
      }
      const snapshot = storage.nodeCostParameters
      const denseSlots = storage.denseNodeCostTerms
      const sparseMap = storage.nodeCostTermsByGridKey
      mutate(solver)
      const after: number[][] = []
      for (const parentZ of [0, 1]) {
        const node = makeNode(parentZ)
        const expectedG = solver.computeG(node)
        const expectedH = solver.computeH(node)
        solver.setNodeCosts(node)
        expect([node.g, node.h, node.f]).toEqual([
          expectedG,
          expectedH,
          solver.computeF(expectedG, expectedH),
        ])
        after.push([node.g, node.h, node.f])
        // Repeated unchanged calls retain both cache storage and snapshot.
        solver.setNodeCosts(makeNode(parentZ))
        expect(storage.nodeCostParameters).toBe(snapshot)
        expect(storage.denseNodeCostTerms).toBe(denseSlots)
        expect(storage.nodeCostTermsByGridKey).toBe(sparseMap)
      }
      expect(after).not.toEqual(before)
    }
    // The sign of a zero denominator changes the exponential penalty.
    // Snapshot equality must distinguish -0 and +0, unlike numeric ===.
    const zeroSolver = new Solver({ ...options, B: { ...options.B } })
    const zeroNode: Node = {
      x: 0,
      y: 0,
      z: 0,
      g: 0,
      h: 0,
      f: 0,
      parent: { x: -0.05, y: 0, z: 0, g: 1, h: 0, f: 0, parent: null },
    }
    zeroSolver.FUTURE_CONNECTION_PROXIMITY_VD = -0
    zeroSolver.setNodeCosts(zeroNode)
    expect(zeroNode.g).toBe(Infinity)
    zeroSolver.FUTURE_CONNECTION_PROXIMITY_VD = +0
    const expectedG = zeroSolver.computeG(zeroNode)
    const expectedH = zeroSolver.computeH(zeroNode)
    zeroSolver.setNodeCosts(zeroNode)
    expect([zeroNode.g, zeroNode.h]).toEqual([expectedG, expectedH])
    expect(Number.isFinite(zeroNode.g)).toBe(true)
  }
})
