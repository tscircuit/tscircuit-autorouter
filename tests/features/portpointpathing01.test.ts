import { test, expect } from "bun:test"
import { HyperPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/HyperPortPointPathingSolver"
import input from "../../fixtures/features/portpointpathing/portpointpathing01-input.json" with {
  type: "json",
}

test.skip(
  "PortPointPathingSolver01 - solves port point pathing",
  () => {
    const solver = new HyperPortPointPathingSolver({
      simpleRouteJson: input.simpleRouteJson as any,
      inputNodes: input.inputNodes as any,
      capacityMeshNodes: input.capacityMeshNodes as any,
      colorMap: input.colorMap as any,
      numShuffleSeeds: 10,
      hyperParameters: input.hyperParameters as any,
    })

    while (!solver.solved && !solver.failed) {
      console.log("iteration", solver.iterations)
      solver.step()
    }

    console.log("iterations:", solver.iterations)
    console.log("solved:", solver.solved)
    console.log("failed:", solver.failed)
    console.log("error:", solver.error)

    expect(solver.solved).toBe(true)
    expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
  },
  { timeout: 60000 },
)
