import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport54-3a54af/bugreport54-3a54af.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test(
  "bugreport54-3a54af.json",
  () => {
    const solver = new AutoroutingPipelineSolver(srj)
    solver.solve()

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)

    const obstacleCenters = new Set(
      solver.srj.obstacles.map(
        (obstacle) => `${obstacle.center.x},${obstacle.center.y}`,
      ),
    )
    expect(obstacleCenters.has("-48,-33")).toBe(false)
    expect(obstacleCenters.has("-48,33")).toBe(false)
    expect(obstacleCenters.has("48,-33")).toBe(false)
    expect(obstacleCenters.has("48,33")).toBe(false)
    expect(solver.srj.bounds).toMatchObject({
      minX: -34.29,
      maxX: 36.83,
      minY: -26.67,
      maxY: 26.67,
    })

    const snapshotPath =
      process.platform === "linux"
        ? import.meta.path.replace(/\.test\.ts$/, "-linux.test.ts")
        : import.meta.path

    expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(snapshotPath)
  },
  { timeout: 180_000 },
)
