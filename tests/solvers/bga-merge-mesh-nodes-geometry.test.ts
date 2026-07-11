import { expect, test } from "bun:test"
import { MergeMeshNodes } from "lib/solvers/BgaTopologyGeneratorSolver/MergeMeshNodes"
import type { CapacityMeshNode } from "lib/types"

const createNode = (
  capacityMeshNodeId: string,
  center: { x: number; y: number },
): CapacityMeshNode => ({
  capacityMeshNodeId,
  center,
  width: 0.45,
  height: 0.45,
  layer: "top",
  availableZ: [0],
})

test("MergeMeshNodes only merges cells whose union fills the merged rectangle", (): void => {
  const separatedSolver = new MergeMeshNodes({
    meshNodes: [
      createNode("grid-origin", { x: 0.225, y: 1.125 }),
      createNode("separated-left", { x: 1.824, y: 0.225 }),
      createNode("separated-right", { x: 2.626, y: 0.225 }),
    ],
    layerCount: 1,
  })
  separatedSolver.solve()

  expect(separatedSolver.getOutput()).toHaveLength(3)
  expect(
    separatedSolver
      .getOutput()
      .some((node: CapacityMeshNode): boolean =>
        node.capacityMeshNodeId.startsWith("merge:"),
      ),
  ).toBe(false)

  const touchingSolver = new MergeMeshNodes({
    meshNodes: [
      createNode("touching-left", { x: 0.225, y: 0.225 }),
      createNode("touching-right", { x: 0.675, y: 0.225 }),
    ],
    layerCount: 1,
  })
  touchingSolver.solve()

  expect(touchingSolver.getOutput()).toHaveLength(1)
  expect(touchingSolver.getOutput()[0]?.width).toBeCloseTo(0.9)
})
