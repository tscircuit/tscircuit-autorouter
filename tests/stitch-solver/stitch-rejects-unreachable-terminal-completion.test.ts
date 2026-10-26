import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("stitching cannot claim PCB terminal completion after exhausting or stranding fragments", (): void => {
  const route = (start: number, end: number, z = 0): HighDensityIntraNodeRoute => ({ connectionName: "unreachable", traceThickness: 0.1, viaDiameter: 0.3, vias: [], route: [{ x: start, y: 0, z }, { x: end, y: 0, z }] })
  const cases = [
    { hdRoutes: [route(0, 1)], end: { x: 100, y: 0, z: 0 }, remaining: 0 },
    { hdRoutes: [route(0, 1), route(10, 11)], end: { x: 11, y: 0, z: 0 }, remaining: 1 },
    { hdRoutes: [route(0, 1)], end: { x: 1, y: 0, z: 7 }, remaining: 0 },
    { hdRoutes: [route(0, 1, 7)], end: { x: 1, y: 0, z: 7 }, remaining: 0 },
  ]
  for (const candidate of cases) {
    const solver = new SingleHighDensityRouteStitchSolver3({
      ...candidate,
      connectionName: "unreachable",
      start: { x: 0, y: 0, z: 0, pcb_port_id: "start" },
      end: { ...candidate.end, pcb_port_id: "end" },
      preserveTerminalPcbPortIds: true,
      preferSameLayerTerminalEndpoints: true,
      layerCount: 8,
      isStitchSegmentClear: (): boolean => true,
      stitchClearanceMode: "require_clear",
    })
    solver.solve()
    expect(solver.solved).toBe(false)
    expect(solver.failed).toBe(true)
    expect(solver.error).toContain("PCB terminal")
    expect(solver.remainingHdRoutes).toHaveLength(candidate.remaining)
  }
})
