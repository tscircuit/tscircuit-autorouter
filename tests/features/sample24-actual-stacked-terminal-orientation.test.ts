import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import fixture from "../fixtures/sample24-stitch-actual-net3.json"

test("actual rounded stacked terminals select an eligible initial fragment and orientation", (): void => {
  const params = structuredClone(fixture) as ConstructorParameters<typeof MultipleHighDensityRouteStitchSolver3>[0]
  const solver = new MultipleHighDensityRouteStitchSolver3(params)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.unsolvedRoutes).toHaveLength(0)
  expect(solver.mergedHdRoutes).toHaveLength(1)
  const route = solver.mergedHdRoutes[0]!
  const endpointLayers = new Map([
    [route.startPcbPortId, route.route[0]!.z],
    [route.endPcbPortId, route.route.at(-1)!.z],
  ])
  expect(endpointLayers.size).toBe(2)
  expect(endpointLayers.get("pcb_port_altium_8622")).toBe(7)
  expect(endpointLayers.get("pcb_port_altium_7312")).toBe(0)
  for (const fragment of fixture.hdRoutes) {
    for (const point of fragment.route.slice(1, -1)) {
      expect(route.route.some((merged) => merged.x === point.x && merged.y === point.y && merged.z === point.z)).toBe(true)
    }
  }
})
