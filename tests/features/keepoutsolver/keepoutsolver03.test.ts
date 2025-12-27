import { test, expect } from "bun:test"
import { TraceKeepoutSolver } from "lib/solvers/TraceKeepoutSolver/TraceKeepoutSolver"
import { ConnectivityMap } from "connectivity-map"
import input from "../../../examples/features/keepoutsolver/keepoutsolver03-input.json"

test("TraceKeepoutSolver - keepoutsolver03", () => {
  const data = (input as any)[0]

  const connMap = new ConnectivityMap(data.connMap.netMap)

  const solver = new TraceKeepoutSolver({
    hdRoutes: data.hdRoutes,
    obstacles: data.obstacles,
    connMap,
    colorMap: data.colorMap,
    keepoutRadiusSchedule: data.keepoutRadiusSchedule,
    srj: data.srj,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.getRedrawnHdRoutes().length).toBeGreaterThan(0)
  expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
})
