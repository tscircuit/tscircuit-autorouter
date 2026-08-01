import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import sample from "./terminal-orientation-placement-sample.json"

test("placement sample uses preserved terminal IDs for route orientation", async () => {
  const solver = new SingleHighDensityRouteStitchSolver3(sample as any)

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoute.startPcbPortId).toBe("pcb_port_end")
  expect(solver.mergedHdRoute.endPcbPortId).toBe("pcb_port_start")
  expect(solver.mergedHdRoute.route).toEqual([
    { x: 1, y: 0, z: 0 },
    { x: 0.4, y: 0.3, z: 0 },
    { x: 0.6, y: 0.3, z: 0 },
    { x: 0, y: 0, z: 0 },
  ])

  const svg = getSvgFromGraphicsObject(solver.visualize(), {
    backgroundColor: "white",
  })
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
