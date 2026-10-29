import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

const classes = [
  SingleHighDensityRouteSolver,
  SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost,
]
type Options = ConstructorParameters<typeof SingleHighDensityRouteSolver>[0]
type Scenario = {
  name: string
  opts: Options
  current: [number, number, number]
  visited: Array<[number, number, number]>
}

const common: Options = {
  connectionName: "parity",
  obstacleRoutes: [],
  minDistBetweenEnteringPoints: 0.2,
  bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
  A: { x: -0.8, y: -0.8, z: 0 },
  B: { x: 0.8, y: 0.8, z: 1 },
  traceThickness: 0.08,
  viaDiameter: 0.18,
  obstacleMargin: 0.04,
  layerCount: 4,
}
const obstacles = [
  {
    connectionName: "wall",
    traceThickness: 0.08,
    viaDiameter: 0.18,
    route: [
      { x: 0.05, y: -0.7, z: 0 },
      { x: 0.05, y: 0.35, z: 0 },
      { x: 0.05, y: 0.35, z: 1 },
      { x: 0.7, y: 0.35, z: 1 },
    ],
    vias: [{ x: 0.05, y: 0.35 }],
  },
]
const futures = [
  {
    connectionName: "future",
    points: [
      { x: -0.4, y: 0.3, z: 0 },
      { x: 0.6, y: 0.3, z: 1 },
    ],
  },
]
const scenarios: Scenario[] = [
  {
    name: "negative-half-grid-multilayer",
    opts: common,
    current: [-0.1, 0.1, 1],
    visited: [[-0.3, -0.1, 1], [-0.1, 0.1, 0], [0.1, 0.3, 1]],
  },
  {
    name: "clamped-edge-aliases",
    opts: { ...common, A: { x: -1, y: -1, z: 0 }, obstacleMargin: 0 },
    current: [-1, -1, 0],
    visited: [[-1, -0.8, 0], [-1, -1, 2]],
  },
  {
    name: "obstacle-and-parent-via",
    opts: { ...common, obstacleRoutes: obstacles },
    current: [-0.1, 0.1, 0],
    visited: [[-0.3, 0.3, 0], [-0.1, 0.1, 3]],
  },
  {
    name: "segment-crossing",
    opts: {
      ...common,
      traceThickness: 0.01,
      obstacleMargin: 0.01,
      nearbySegmentClearance: 0.01,
      obstacleRoutes: [
        {
          connectionName: "crossing",
          traceThickness: 0.01,
          viaDiameter: 0.1,
          route: [
            { x: -0.1, y: -0.03, z: 0 },
            { x: -0.1, y: 0.03, z: 0 },
          ],
          vias: [],
        },
      ],
    },
    current: [0, 0, 0],
    visited: [[0, 0.2, 0], [0, 0, 2]],
  },
  {
    name: "all-proposals-explored",
    opts: common,
    current: [0, 0, 1],
    visited: [
      [-0.2, -0.2, 1], [-0.2, 0, 1], [-0.2, 0.2, 1],
      [0, -0.2, 1], [0, 0.2, 1],
      [0.2, -0.2, 1], [0.2, 0, 1], [0.2, 0.2, 1],
      [0, 0, 0], [0, 0, 2], [0, 0, 3],
    ],
  },
  {
    name: "future-cost-and-filtered-layers",
    opts: {
      ...common,
      obstacleRoutes: obstacles,
      futureConnections: futures,
      availableZ: [3, 1, 1],
      hyperParameters: { CELL_SIZE_FACTOR: 0.75 },
    },
    current: [-0.225, 0.075, 1],
    visited: [[-0.375, -0.075, 1], [-0.225, 0.075, 3]],
  },
]

function nodeSnapshot(node: Node): unknown {
  const parents: number[][] = []
  for (let parent = node.parent; parent; parent = parent.parent) {
    parents.push([parent.x, parent.y, parent.z, parent.g, parent.h, parent.f])
  }
  return { x: node.x, y: node.y, z: node.z, g: node.g, h: node.h, f: node.f, parents }
}

function stateSnapshot(solver: SingleHighDensityRouteSolver): unknown {
  return {
    explored: [...solver.exploredNodes],
    tooClose: [...solver.debug_nodesTooCloseToObstacle],
    intersects: [...solver.debug_nodePathToParentIntersectsObstacle],
    ordered: solver.debug_exploredNodesOrdered,
    memo: [...solver.freePlanarObstaclePoints],
    candidates: solver.candidates.getTopN(100000).map(nodeSnapshot),
  }
}

// Frozen from 8f781900 before moving visited rejection ahead of allocation.
// Each digest covers full costs, ancestry, neighbor order, explored/debug sets,
// and positive point memo entries, with search debug both enabled and disabled.
const expectedNeighborHashes = [
  "fb8bfb203f23b7d288324209105a1d64ba192401e587c80b8d43dc726ef2a34e",
  "5959aa8b5a71603155ed11d8ed095eb9da640d398bb6e2dd3e79ffe7b47f62da",
  "8b1f9a049f6f014b1223c2d73fe143bd6a077e6ad1a2eafaffae7e59b9cff9bd",
  "8a52365aa6d7c2379c1408a8266815fbd8e0987725d2f819c03bef8dcac31560",
  "07b0bd7ebee3e7a749d5a35085b2861ff1d1e292fcacd035c986b5562b130df3",
  "75314c3a515ef332fa17684909247d9113057edf28ae1a15f25c32ddebaee788",
  "6c1c6232794d44d68844cd0ee36767c0ec36bd4289d04f959edd0aa50faf9235",
  "f63c1e9ea38f178be0d4ffee0302613c1dd3b170ad8ee334e28546ff0ae36283",
  "1856bd360e7798925f830d057f7fdb5e16b60b63d4e7269edc89278028ecae52",
  "e546ff1a736ec38965b273aa5a644ca4c010b1bb26bcc0370510ba688a1b5e7d",
  "915dbec50281f120d146e8e532d67d1019f86edc4d25caea9e4699ff28dced46",
  "726220b43d6ee6d1f9de49fcd2b6fad8434bec52bd3cda3ed84e6f57804870c9",
  "2d76e10f173b6c3f9b079dbea4f281916244128800537907515682ea932837dd",
  "f9570ad9cc3f5b0ad3e1b69225070cb39f47eb1bf6c86286d50eee77fec823cf",
  "4d57a3a3d088ae49640deff9ce062561c6e43b50a83e4135a1c8c2e3764bd5ac",
  "8f8334f6eefa6a6dcf1c8071e3a519d6825472970f423d47d1f24f91f39ea396",
  "cdb3b1219238467f37387e2199e9b979c27148d88feba306296994a87b9483e7",
  "bb00f5364bde82ee69c81be1ecfa454aaa6fdb1626f9d0f303bf9461f8b06107",
  "72b1ea199439f0ec11a2a0f02bf8da3190d15ae79be2541db2ed7fd52d60b44a",
  "73cebd001dc3733b08cbec5c80238483e4d4bc2c34d2f652a6a2a3e889a479b1",
  "38c026616da804167aa6101a49cda0c0a4fa3b882951a7701e779335d6da6928",
  "466787d5720ff6c922116408f27906bc7ab7a003ba4baba432c1682f4bd2f70e",
  "8c0fbdd391438d5dafc2af8ab059b7c4cddacca03dd52fa553385ffb9debd6d8",
  "bc474c0e1e300248633ba7733f3e7204cf1e744ed1eb1bb8cfa2047a62e00de9",
]

test("neighbor rejection preserves exact nodes, aliases, layers and search state", (): void => {
  const actualHashes: string[] = []
  for (const [classIndex, Solver] of classes.entries()) {
    for (const captureSearchDebug of [true, false]) {
      for (const scenario of scenarios) {
        const opts = structuredClone({ ...scenario.opts, captureSearchDebug })
        const before = JSON.stringify(opts)
        const solver = new Solver(opts)
        const current: Node = {
          x: scenario.current[0],
          y: scenario.current[1],
          z: scenario.current[2],
          g: 2.5,
          h: 3.25,
          f: 6.075,
          parent: {
            x: -0.6,
            y: -0.6,
            z: scenario.current[2],
            g: 1,
            h: 2,
            f: 3.2,
            parent: {
              x: -0.6,
              y: -0.6,
              z: scenario.name === "obstacle-and-parent-via"
                ? 2
                : scenario.current[2],
              g: 0,
              h: 0,
              f: 0,
              parent: null,
            },
          },
        }
        for (const [x, y, z] of scenario.visited) {
          solver.exploredNodes.add(solver.getNodeKey({ ...current, x, y, z }))
        }
        const beforeNode = JSON.stringify(current)
        const neighbors = solver.getNeighbors(current)
        const snapshot = {
          name: scenario.name,
          classIndex,
          captureSearchDebug,
          cellStep: solver.cellStep,
          neighbors: neighbors.map(nodeSnapshot),
          parentsIdentical: neighbors.every(
            (neighbor): boolean => neighbor.parent === current,
          ),
          inputUnchanged: before === JSON.stringify(opts) &&
            beforeNode === JSON.stringify(current),
          state: stateSnapshot(solver),
        }
        expect(snapshot.parentsIdentical).toBe(true)
        expect(snapshot.inputUnchanged).toBe(true)
        if (scenario.name === "clamped-edge-aliases") {
          expect(neighbors.map(({ x, y, z }): number[] => [x, y, z])).toEqual([
            [-1, -1, 0], [-1, -1, 0], [-1, -1, 0],
            [-0.8, -1, 0], [-0.8, -1, 0], [-0.8, -0.8, 0],
          ])
        }
        if (scenario.name === "negative-half-grid-multilayer") {
          expect(
            neighbors
              .filter((neighbor): boolean => neighbor.z !== current.z)
              .map((neighbor): number => neighbor.z),
          ).toEqual([2, 3])
        }
        if (scenario.name === "all-proposals-explored") {
          expect(neighbors).toEqual([])
          expect(solver.freePlanarObstaclePoints.size).toBe(0)
        }
        actualHashes.push(
          createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"),
        )
      }
    }
  }
  expect(actualHashes).toEqual(expectedNeighborHashes)
})
