import { expect } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

type Fixture = {
  params: ConstructorParameters<typeof MultipleHighDensityRouteStitchSolver3>[0]
  originalObstacles: Array<{
    center: { x: number; y: number }
    width: number
    height: number
    layers: string[]
    ccwRotationDegrees?: number
    circuitJsonMetadata?: { pcb_port_id?: string }
  }>
}

export const assertOriginalTerminalContacts = (fixture: Fixture): void => {
  const params = structuredClone(fixture.params)
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
  for (const terminal of original.connections[0]!.pointsToConnect) {
    const endpoint = endpoints.find(({ id }) => id === terminal.pcb_port_id)!
    const pad = fixture.originalObstacles.find(
      (candidate) => candidate.circuitJsonMetadata?.pcb_port_id === terminal.pcb_port_id,
    )!
    expect(endpoint).toBeDefined()
    expect(pad).toBeDefined()
    expect(pad.layers.map((layer) => mapLayerNameToZ(layer, params.layerCount))).toContain(endpoint.point.z)
    const dx = endpoint.point.x - pad.center.x, dy = endpoint.point.y - pad.center.y
    const angle = -(pad.ccwRotationDegrees ?? 0) * Math.PI / 180
    const x = dx * Math.cos(angle) - dy * Math.sin(angle)
    const y = dx * Math.sin(angle) + dy * Math.cos(angle)
    const gap = Math.hypot(Math.max(0, Math.abs(x) - pad.width / 2), Math.max(0, Math.abs(y) - pad.height / 2))
    expect(gap).toBeLessThanOrEqual(route.traceThickness / 2)
    expect(Math.hypot(endpoint.point.x - terminal.x, endpoint.point.y - terminal.y)).toBeLessThanOrEqual(1e-3)
  }
  const declaredVias = original.hdRoutes.flatMap((fragment) => fragment.vias)
  for (let index = 0; index < route.route.length - 1; index++) {
    const point = route.route[index]!, next = route.route[index + 1]!
    if (point.z === next.z) continue
    expect(Math.hypot(point.x - next.x, point.y - next.y)).toBeLessThanOrEqual(1e-6)
    expect(declaredVias.some((via) => Math.hypot(via.x - point.x, via.y - point.y) <= 1e-6)).toBe(true)
  }
  expect(params).toEqual(original)
}
