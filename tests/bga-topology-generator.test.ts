import { expect, test } from "bun:test"
import { BgaTopologyGeneratorSolver } from "lib/solvers/BgaTopologyGeneratorSolver/BgaTopologyGeneratorSolver"
import type { CapacityMeshNode, Obstacle, SimpleRouteJson } from "lib/types"

const createPad = ({
  obstacleId,
  x,
  y,
  size = 0.5,
}: {
  obstacleId: string
  x: number
  y: number
  size?: number
}): Obstacle => ({
  obstacleId,
  componentId: "U_BGA",
  type: "rect",
  layers: ["top"],
  center: { x, y },
  width: size,
  height: size,
  connectedTo: [],
})

const createTwoByTwoBgaSrj = ({
  pitch,
  padSize = 0.5,
  viaDiameter = 0.3,
  obstacleMargin = 0.1,
}: {
  pitch: number
  padSize?: number
  viaDiameter?: number
  obstacleMargin?: number
}): SimpleRouteJson => ({
  layerCount: 2,
  minTraceWidth: 0.1,
  min_via_pad_diameter: viaDiameter,
  defaultObstacleMargin: obstacleMargin,
  obstacles: [
    createPad({ obstacleId: "U_BGA.A1", x: 0, y: 0, size: padSize }),
    createPad({ obstacleId: "U_BGA.A2", x: pitch, y: 0, size: padSize }),
    createPad({ obstacleId: "U_BGA.B1", x: 0, y: pitch, size: padSize }),
    createPad({ obstacleId: "U_BGA.B2", x: pitch, y: pitch, size: padSize }),
  ],
  connections: [],
  bounds: {
    minX: -padSize / 2,
    maxX: pitch + padSize / 2,
    minY: -padSize / 2,
    maxY: pitch + padSize / 2,
  },
})

const solveBgaNodes = (srj: SimpleRouteJson) => {
  const solver = new BgaTopologyGeneratorSolver({ inputSrj: srj })
  solver.solve()
  return solver.getOutput().routingRegions
}

const findNodesAt = (
  nodes: CapacityMeshNode[],
  center: { x: number; y: number },
) =>
  nodes.filter(
    (node) =>
      Math.abs(node.center.x - center.x) < 1e-9 &&
      Math.abs(node.center.y - center.y) < 1e-9,
  )

test("BGA topology makes via-sized cells right of and below pads multi-layer", () => {
  const nodes = solveBgaNodes(createTwoByTwoBgaSrj({ pitch: 1 }))

  expect(
    findNodesAt(nodes, { x: 0.5, y: 0 }).some(
      (node) => node.availableZ.length === 2,
    ),
  ).toBe(true)
  expect(
    findNodesAt(nodes, { x: 0, y: 0.5 }).some(
      (node) => node.availableZ.length === 2,
    ),
  ).toBe(true)
})

test("BGA topology keeps side-adjacent cells single-layer when too small for a via", () => {
  const nodes = solveBgaNodes(createTwoByTwoBgaSrj({ pitch: 0.8 }))

  expect(
    findNodesAt(nodes, { x: 0.4, y: 0 }).some(
      (node) => node.availableZ.length > 1,
    ),
  ).toBe(false)
  expect(
    findNodesAt(nodes, { x: 0, y: 0.4 }).some(
      (node) => node.availableZ.length > 1,
    ),
  ).toBe(false)
})
