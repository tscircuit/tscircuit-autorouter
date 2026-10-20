import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("rejects incomplete shared-root probes without weakening final terminal validation", (): void => {
  const route: HighDensityIntraNodeRoute = {
    connectionName: "a_to_c",
    rootConnectionName: "net",
    startPcbPortId: "a",
    endPcbPortId: "c",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
    vias: [],
  }
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: [{ name: "a_to_c", pointsToConnect: [
      { x: 0, y: 0, layer: "top", pcb_port_id: "a" },
      { x: 2, y: 0, layer: "top", pcb_port_id: "c" },
    ] }],
    hdRoutes: [route],
    layerCount: 2,
    preserveTerminalPcbPortIds: true,
  })
  type Probe = (params: {
    connectionName: string
    hdRoutes: HighDensityIntraNodeRoute[]
    start: { x: number; y: number; z: number; pcb_port_id: string }
    end: { x: number; y: number; z: number; pcb_port_id: string }
  }) => boolean
  const probe = Reflect.get(solver, "canStitchBetweenTerminals") as Probe
  const selection = {
    connectionName: "a_to_b",
    hdRoutes: [route],
    start: { x: 0, y: 0, z: 0, pcb_port_id: "a" },
    end: { x: 6, y: 0, z: 0, pcb_port_id: "b" },
  }
  expect(probe.call(solver, selection)).toBe(false)
  expect(probe.call(solver, { ...selection, end: { x: 2, y: 0, z: 0, pcb_port_id: "c" } })).toBe(true)
  expect(() => probe.call(solver, { ...selection, end: { x: 2, y: 0, z: 0, pcb_port_id: "foreign" } })).toThrow("unknown PCB terminal")
})
