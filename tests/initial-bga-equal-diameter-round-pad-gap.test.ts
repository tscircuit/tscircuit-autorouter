import { expect, test } from "bun:test"
import { InitialBgaTopologySolver } from "lib/solvers/BgaTopologyGeneratorSolver/InitialBgaTopologySolver"
import type { CapacityMeshNode, Obstacle, SimpleRouteJson } from "lib/types"

// Native ButterStick FPGA pads W2/W3/Y2/Y3: 0.4 mm circles on 0.8 mm pitch.
const pads: Obstacle[] = [
  [445, -19.200000000000006, -5.2000000000000055],
  [446, -18.400000000000006, -5.2000000000000055],
  [464, -19.200000000000006, -6.000000000000005],
  [465, -18.400000000000006, -6.000000000000005],
].map(
  ([id, x, y]): Obstacle => ({
    type: "rect",
    shape: "circle",
    componentId: "pcb_component_1",
    center: { x: x!, y: y! },
    width: 0.4,
    height: 0.4,
    layers: ["top"],
    connectedTo: [`pcb_smtpad_${id}`],
  }),
)

function getViaColumn(srj: SimpleRouteJson): CapacityMeshNode[] {
  const solver = new InitialBgaTopologySolver({
    srj,
    componentId: "pcb_component_1",
    componentBounds: srj.bounds,
    markedComponentObstacles: pads,
    unmarkedComponentObstacles: srj.obstacles.filter(
      (obstacle) => obstacle.componentId !== "pcb_component_1",
    ),
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  return solver
    .getOutput()
    .filter(
      (node) =>
        !node._containsObstacle &&
        Math.hypot(node.center.x + 18.8, node.center.y + 5.6) < 1e-8,
    )
}

test("a via matching the round-pad gap still receives the physical clearance check", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 8,
    minTraceWidth: 0.089,
    minViaPadDiameter: 0.4,
    minViaHoleDiameter: 0.2,
    minViaEdgeToPadEdgeClearance: 0.0889,
    minPadEdgeToPadEdgeClearance: 0.1,
    minBoardEdgeClearance: 0.2,
    bounds: { minX: -20, maxX: -17.6, minY: -6.8, maxY: -4.4 },
    obstacles: pads,
    connections: [],
  }
  const original = structuredClone(srj)
  const column = getViaColumn(srj)
  expect(column).toHaveLength(1)
  expect(column[0]!.availableZ).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  expect(srj).toEqual(original)

  const stricter = getViaColumn({
    ...srj,
    minPadEdgeToPadEdgeClearance: 0.17,
  })
  expect(stricter).toHaveLength(8)
  expect(stricter.every((node) => node.availableZ.length === 1)).toBe(true)
  const blocked = getViaColumn({
    ...srj,
    obstacles: [
      ...pads,
      {
        type: "rect",
        center: { x: -18.8, y: -5.6 },
        width: 0.05,
        height: 0.05,
        layers: ["inner3"],
        connectedTo: [],
      },
    ],
  })
  expect(blocked).toHaveLength(8)
  expect(blocked.every((node) => node.availableZ.length === 1)).toBe(true)
})
