import { expect, test } from "bun:test"
import { createBugreport86PortPointPathingSolver } from "../fixtures/createBugreport86PortPointPathingSolver"

test.failing(
  "port point pathing does not change layers inside nodes smaller than a via",
  (): void => {
    const { solver, minViaPadDiameter } =
      createBugreport86PortPointPathingSolver()

    solver.solve()

    expect(solver.error).toBeNull()
    expect(solver.failed).toBe(false)
    expect(solver.solved).toBe(true)

    const output = solver.getOutput()

    for (const node of output.nodesWithPortPoints) {
      const minDimension = Math.min(node.width, node.height)
      for (const [p1, p2] of node.portPointsInPairs ?? []) {
        if (p1.z !== p2.z) {
          expect(minDimension).toBeGreaterThanOrEqual(minViaPadDiameter)
        }
      }
    }
  },
)
