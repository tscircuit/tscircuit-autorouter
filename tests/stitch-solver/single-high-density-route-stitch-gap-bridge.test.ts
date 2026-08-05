import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

const makeRoute = (
  connectionName: string,
  points: Array<{ x: number; y: number; z: number }>,
): HighDensityIntraNodeRoute => ({
  connectionName,
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: points,
  vias: [],
  jumpers: [],
})

test("single stitch bridges small same-layer gaps", () => {
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "conn",
    start: { x: 0, y: 0, z: 0 },
    end: { x: 2, y: 0, z: 0 },
    hdRoutes: [
      makeRoute("conn", [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ]),
      makeRoute("conn", [
        { x: 1.5, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ]),
    ],
    isStitchSegmentClear: () => true,
    stitchClearanceMode: "require_clear",
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoute.route).toEqual([
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 1.5, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
  ])
})

test("single stitch does not bridge large same-layer gaps", () => {
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "conn",
    start: { x: 0, y: 0, z: 0 },
    end: { x: 3, y: 0, z: 0 },
    hdRoutes: [
      makeRoute("conn", [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ]),
      makeRoute("conn", [
        { x: 2.5, y: 0, z: 0 },
        { x: 3, y: 0, z: 0 },
      ]),
    ],
    isStitchSegmentClear: () => true,
    stitchClearanceMode: "require_clear",
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoute.route).toEqual([
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
  ])
})

test("single stitch can cap a modest terminal endpoint gap", () => {
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "conn",
    start: { x: 0, y: 2, z: 0 },
    end: { x: 0, y: 0, z: 0 },
    hdRoutes: [
      makeRoute("conn", [
        { x: 0.2, y: 1.3, z: 0 },
        { x: 0.3, y: 1.1, z: 0 },
      ]),
    ],
    isStitchSegmentClear: () => true,
    stitchClearanceMode: "require_clear",
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoute.route).toEqual([
    { x: 0, y: 2, z: 0 },
    { x: 0.2, y: 1.3, z: 0 },
    { x: 0.3, y: 1.1, z: 0 },
    { x: 0, y: 0, z: 0 },
  ])
})

test("single stitch accepts fan-out terminal tags", () => {
  const terminalFanoutRoutes = [
    {
      ...makeRoute("conn", [
        { x: 0, y: 0, z: 0 },
        { x: 3, y: 0, z: 0 },
      ]),
      startPcbPortId: "pcb_port_start",
    },
    {
      ...makeRoute("conn", [
        { x: 0, y: 0, z: 0 },
        { x: 6, y: 0, z: 0 },
      ]),
      startPcbPortId: "pcb_port_start",
    },
  ]
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "conn",
    start: { x: 0, y: 0, z: 0, pcb_port_id: "pcb_port_start" },
    end: { x: 10, y: 0, z: 0, pcb_port_id: "pcb_port_end" },
    hdRoutes: terminalFanoutRoutes,
    preserveTerminalPcbPortIds: true,
    isStitchSegmentClear: () => true,
    stitchClearanceMode: "require_clear",
  })

  expect(solver.mergedHdRoute.startPcbPortId).toBe("pcb_port_start")
  expect(solver.mergedHdRoute.endPcbPortId).toBe("pcb_port_end")
})
