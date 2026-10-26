import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import fixture from "../fixtures/sample24-stitch-actual-net377.json"

test("actual sample24 stacked SMT terminals retain their distinct IDs and layers", (): void => {
  const params = structuredClone(fixture) as ConstructorParameters<typeof MultipleHighDensityRouteStitchSolver3>[0]
  const original = structuredClone(params)
  const solver = new MultipleHighDensityRouteStitchSolver3(params)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.unsolvedRoutes).toHaveLength(0)
  expect(solver.mergedHdRoutes).toHaveLength(1)
  const route = solver.mergedHdRoutes[0]!
  const endpoints = [
    { id: route.startPcbPortId, point: route.route[0]! },
    { id: route.endPcbPortId, point: route.route.at(-1)! },
  ]
  for (const [index, id] of ["pcb_port_altium_8623", "pcb_port_altium_7313"].entries()) {
    const endpoint = endpoints.find((candidate) => candidate.id === id)!
    const terminal = original.connections[0]!.pointsToConnect[index]!
    expect(endpoint.point.z).toBe(index === 0 ? 7 : 0)
    // The repair output retains its rounded copper coordinates. Stitching
    // assigns identity and layer within its existing 1um endpoint tolerance.
    expect(Math.hypot(endpoint.point.x - terminal.x, endpoint.point.y - terminal.y)).toBeLessThanOrEqual(1e-3)
  }
  for (const fragment of original.hdRoutes) {
    for (const point of fragment.route.slice(1, -1)) {
      expect(route.route.some((merged) => merged.x === point.x && merged.y === point.y && merged.z === point.z)).toBe(true)
    }
  }
  expect(params).toEqual(original)
})
