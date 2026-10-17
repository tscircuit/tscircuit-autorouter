import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("allows an intermediate PCB terminal from the same root net", (): void => {
  const hdRoutes: HighDensityIntraNodeRoute[] = [
    {
      connectionName: "net_mst0",
      rootConnectionName: "net",
      startPcbPortId: "pcb_port_a",
      endPcbPortId: "pcb_port_b",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "net_mst1",
      rootConnectionName: "net",
      startPcbPortId: "pcb_port_b",
      endPcbPortId: "pcb_port_c",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ],
      vias: [],
    },
  ]

  const createSolver = (allowedPcbPortIds?: ReadonlySet<string>) =>
    new SingleHighDensityRouteStitchSolver3({
      connectionName: "net_mst1",
      hdRoutes,
      start: { x: 0, y: 0, z: 0, pcb_port_id: "pcb_port_a" },
      end: { x: 2, y: 0, z: 0, pcb_port_id: "pcb_port_c" },
      allowedPcbPortIds,
      enableCompleteTerminalStitching: true,
      preserveTerminalPcbPortIds: true,
      isStitchSegmentClear: () => true,
      stitchClearanceMode: "require_clear",
    })

  expect(() => createSolver()).toThrow('unknown PCB terminal "pcb_port_b"')

  const solver = createSolver(
    new Set(["pcb_port_a", "pcb_port_b", "pcb_port_c"]),
  )
  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.mergedHdRoute.startPcbPortId).toBe("pcb_port_a")
  expect(solver.mergedHdRoute.endPcbPortId).toBe("pcb_port_c")
  expect(solver.mergedHdRoute.route.at(-1)).toEqual({ x: 2, y: 0, z: 0 })
})
