import { expect, test } from "bun:test"
import { materializePipeline9HdRouteVias } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/materializePipeline9HdRouteVias"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("stitches through a routed via chain instead of a nearby layer shortcut", (): void => {
  const common = {
    connectionName: "signal",
    traceThickness: 0.1,
    viaDiameter: 0.3,
  }
  const hdRoutes: HighDensityIntraNodeRoute[] = [
    {
      ...common,
      startPcbPortId: "start",
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 0.0005, y: 0, z: 0 },
      ],
      vias: [],
    },
    {
      ...common,
      endPcbPortId: "end",
      route: [
        { x: 0, y: 0, z: 3 },
        { x: 1, y: 0, z: 3 },
      ],
      vias: [],
    },
    {
      ...common,
      route: [
        { x: 0.05, y: 0, z: 0 },
        { x: 0.05, y: 0.05, z: 0 },
        { x: 0.05, y: 0.05, z: 1 },
        { x: 0.1, y: 0, z: 1 },
      ],
      vias: [{ x: 0.05, y: 0.05 }],
    },
    {
      ...common,
      route: [
        { x: 0.1, y: 0, z: 1 },
        { x: 0.1, y: 0.1, z: 1 },
        { x: 0.1, y: 0.1, z: 3 },
        { x: 0.05, y: 0, z: 3 },
      ],
      vias: [{ x: 0.1, y: 0.1 }],
    },
  ]
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "signal",
    hdRoutes,
    start: { x: -1, y: 0, z: 0, pcb_port_id: "start" },
    end: { x: 1, y: 0, z: 3, pcb_port_id: "end" },
    preserveTerminalPcbPortIds: true,
    isStitchSegmentClear: () => true,
    stitchClearanceMode: "require_clear",
  })
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.mergedHdRoute.vias).toEqual([
    { x: 0.05, y: 0.05 },
    { x: 0.1, y: 0.1 },
  ])
  expect(solver.mergedHdRoute.route[0]).toEqual({ x: -1, y: 0, z: 0 })
  expect(solver.mergedHdRoute.route.at(-1)).toEqual({ x: 1, y: 0, z: 3 })
  expect(() =>
    materializePipeline9HdRouteVias([solver.mergedHdRoute]),
  ).not.toThrow()
})
