import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { MuSolver } from "lib/solvers/MuSolver/MuSolver"
import { buildTwoBgaTopologyExample } from "lib/solvers/MuSolver/examples/twoBgaTopologies"
import { visualizeTopologySlices } from "lib/solvers/MuSolver/visualizeMergedTopology3D"

test("MuSolver merges two every-layer BGA topologies into a seamed slice view", () => {
  const example = buildTwoBgaTopologyExample()
  const solver = new MuSolver(example)
  solver.solve()

  const merged = solver.getOutput().routingRegions
  const svg = getSvgFromGraphicsObject(
    visualizeTopologySlices(merged, example.layerCount),
    { backgroundColor: "white" },
  )

  expect(svg).toMatchSvgSnapshot(import.meta.path)
})
