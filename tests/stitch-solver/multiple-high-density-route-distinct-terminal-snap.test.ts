import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import { snapIslandEndpointsToDistinctTerminals } from "lib/solvers/RouteStitchingSolver/routeStitchingEndpointHelpers"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

const makeRoute = (
  points: Array<{ x: number; y: number; z: number }>,
): HighDensityIntraNodeRoute => ({
  connectionName: "conn",
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: points,
  vias: [],
  jumpers: [],
})

test("partial island endpoints do not both snap to the same PCB terminal", () => {
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: [
      {
        name: "conn",
        pointsToConnect: [
          {
            x: -10,
            y: 0,
            layer: "top",
            pointId: "pcb_port_far",
            pcb_port_id: "pcb_port_far",
          },
          {
            x: 0,
            y: 0,
            layer: "top",
            pointId: "pcb_port_near",
            pcb_port_id: "pcb_port_near",
          },
        ],
      },
    ],
    hdRoutes: [
      makeRoute([
        { x: 0, y: 0, z: 0 },
        { x: 0.4, y: 0, z: 0 },
      ]),
      makeRoute([
        { x: 0.4, y: 0, z: 0 },
        { x: 0.8, y: 0, z: 0 },
      ]),
    ],
    layerCount: 2,
    preserveTerminalPcbPortIds: true,
    preserveDistinctTerminalSnaps: true,
  })

  expect(solver.unsolvedRoutes).toHaveLength(1)
  const [unsolvedRoute] = solver.unsolvedRoutes
  const startPcbPortId = (
    unsolvedRoute?.start as { pcb_port_id?: string } | undefined
  )?.pcb_port_id
  const endPcbPortId = (
    unsolvedRoute?.end as { pcb_port_id?: string } | undefined
  )?.pcb_port_id
  expect(startPcbPortId).not.toBe(endPcbPortId)

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
})

test("distinct terminal snapping remains opt-in", () => {
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: [
      {
        name: "conn",
        pointsToConnect: [
          {
            x: -10,
            y: 0,
            layer: "top",
            pointId: "pcb_port_far",
            pcb_port_id: "pcb_port_far",
          },
          {
            x: 0,
            y: 0,
            layer: "top",
            pointId: "pcb_port_near",
            pcb_port_id: "pcb_port_near",
          },
        ],
      },
    ],
    hdRoutes: [
      makeRoute([
        { x: 0, y: 0, z: 0 },
        { x: 0.4, y: 0, z: 0 },
      ]),
      makeRoute([
        { x: 0.4, y: 0, z: 0 },
        { x: 0.8, y: 0, z: 0 },
      ]),
    ],
    layerCount: 2,
    preserveTerminalPcbPortIds: true,
  })

  expect(solver.unsolvedRoutes).toHaveLength(1)
  const [unsolvedRoute] = solver.unsolvedRoutes
  expect(
    (unsolvedRoute?.start as { pcb_port_id?: string } | undefined)?.pcb_port_id,
  ).toBe("pcb_port_near")
  expect(
    (unsolvedRoute?.end as { pcb_port_id?: string } | undefined)?.pcb_port_id,
  ).toBe("pcb_port_near")
})

test("pointId-only island endpoints do not both snap to one terminal", () => {
  const nearTerminal = {
    x: 0,
    y: 0,
    z: 0,
    pointId: "near_terminal",
  }
  const result = snapIslandEndpointsToDistinctTerminals({
    start: { x: 0, y: 0, z: 0 },
    end: { x: 0.4, y: 0, z: 0 },
    terminals: [{ x: -10, y: 0, z: 0, pointId: "far_terminal" }, nearTerminal],
  })

  expect(result.start).toBe(nearTerminal)
  expect(result.end).toEqual({ x: 0.4, y: 0, z: 0 })
})

test("terminal layer preservation adds endpoint vias around a wrong-layer island", () => {
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: [
      {
        name: "conn",
        pointsToConnect: [
          {
            x: 0,
            y: 0,
            layer: "top",
            pointId: "start",
            pcb_port_id: "start",
          },
          {
            x: 2,
            y: 0,
            layer: "top",
            pointId: "end",
            pcb_port_id: "end",
          },
        ],
      },
    ],
    hdRoutes: [
      makeRoute([
        { x: 0, y: 0, z: 1 },
        { x: 2, y: 0, z: 1 },
      ]),
    ],
    layerCount: 2,
    preserveTerminalPcbPortIds: true,
    preserveTerminalLayers: true,
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoutes).toHaveLength(1)
  expect(solver.mergedHdRoutes[0]?.route).toEqual([
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 2, y: 0, z: 1 },
    { x: 2, y: 0, z: 0 },
  ])
  expect(solver.mergedHdRoutes[0]?.vias).toEqual([
    { x: 0, y: 0 },
    { x: 2, y: 0 },
  ])
})

test("terminal layer preservation remains opt-in", () => {
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: [
      {
        name: "conn",
        pointsToConnect: [
          {
            x: 0,
            y: 0,
            layer: "top",
            pointId: "start",
            pcb_port_id: "start",
          },
          {
            x: 2,
            y: 0,
            layer: "top",
            pointId: "end",
            pcb_port_id: "end",
          },
        ],
      },
    ],
    hdRoutes: [
      makeRoute([
        { x: 0, y: 0, z: 1 },
        { x: 2, y: 0, z: 1 },
      ]),
    ],
    layerCount: 2,
    preserveTerminalPcbPortIds: true,
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoutes).toHaveLength(1)
  expect(solver.mergedHdRoutes[0]?.route).toEqual([
    { x: 0, y: 0, z: 1 },
    { x: 2, y: 0, z: 1 },
  ])
  expect(solver.mergedHdRoutes[0]?.vias).toEqual([])
})
