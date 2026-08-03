import { expect, test } from "bun:test"
import { DifferentialPairPostProcessingSolver } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/differential-pair-post-processing-solver"

const getRouteLength = (route: Array<{ x: number; y: number }>): number => {
  let length = 0
  for (let index = 1; index < route.length; index++) {
    const previous = route[index - 1]!
    const point = route[index]!
    length += Math.hypot(point.x - previous.x, point.y - previous.y)
  }
  return length
}

test("Pipeline7 length matches asymmetric terminals without changing endpoints", () => {
  const createPad = (x: number, y: number, connectionName?: string) => ({
    type: "rect" as const,
    layers: ["top"],
    center: { x, y },
    width: 1,
    height: 0.6,
    connectedTo: connectionName ? [connectionName] : [],
  })
  const params = {
    hdRoutes: [
      {
        connectionName: "source_trace_1",
        startPcbPortId: "pcb_port_u1_pin2",
        endPcbPortId: "pcb_port_u2_pin6",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          {
            x: -7.15,
            y: 0.635,
            z: 0,
            traceThickness: 0.15,
            pcb_port_id: "pcb_port_u1_pin2",
          },
          {
            x: -6.410152979700772,
            y: -0.10484702029922843,
            z: 0,
            traceThickness: 0.15,
          },
          {
            x: 6.619847020299229,
            y: -0.10484702029922849,
            z: 0,
            traceThickness: 0.15,
          },
          {
            x: 7.15,
            y: -0.635,
            z: 0,
            traceThickness: 0.15,
            pcb_port_id: "pcb_port_u2_pin6",
          },
        ],
        vias: [],
      },
      {
        connectionName: "source_trace_0",
        startPcbPortId: "pcb_port_u1_pin1",
        endPcbPortId: "pcb_port_u2_pin1",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          {
            x: -7.15,
            y: 1.905,
            z: 0,
            traceThickness: 0.15,
            pcb_port_id: "pcb_port_u1_pin1",
          },
          {
            x: -6.61985218617334,
            y: 2.4351478138266605,
            z: 0,
            traceThickness: 0.15,
          },
          {
            x: 2.3198521861733394,
            y: 2.4351478138266605,
            z: 0,
            traceThickness: 0.15,
          },
          {
            x: 2.85,
            y: 1.905,
            z: 0,
            traceThickness: 0.15,
            pcb_port_id: "pcb_port_u2_pin1",
          },
        ],
        vias: [],
      },
    ],
    differentialPairs: [
      {
        connectionNames: ["source_trace_0", "source_trace_1"] as [
          string,
          string,
        ],
        lengthTolerance: 0.05,
      },
    ],
    obstacles: [
      createPad(-7.15, 1.905, "source_trace_0"),
      createPad(-7.15, 0.635, "source_trace_1"),
      createPad(-7.15, -0.635),
      createPad(-7.15, -1.905),
      createPad(-2.85, -1.905),
      createPad(-2.85, -0.635),
      createPad(-2.85, 0.635),
      createPad(-2.85, 1.905),
      createPad(2.85, 1.905, "source_trace_0"),
      createPad(2.85, 0.635),
      createPad(2.85, -0.635),
      createPad(2.85, -1.905),
      createPad(7.15, -1.905),
      createPad(7.15, -0.635, "source_trace_1"),
      createPad(7.15, 0.635),
      createPad(7.15, 1.905),
    ],
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
    layerCount: 2,
  }
  const originalRoutes = structuredClone(params.hdRoutes)
  const solver = new DifferentialPairPostProcessingSolver(params)

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const outputRoutes = solver.getOutput().hdRoutes
  const routesByName = new Map(
    outputRoutes.map((route) => [route.connectionName, route]),
  )
  const first = routesByName.get("source_trace_0")!
  const second = routesByName.get("source_trace_1")!

  expect(first.route[0]).toEqual(originalRoutes[1]!.route[0])
  expect(first.route.at(-1)).toEqual(originalRoutes[1]!.route.at(-1))
  expect(second.route[0]).toEqual(originalRoutes[0]!.route[0])
  expect(second.route.at(-1)).toEqual(originalRoutes[0]!.route.at(-1))
  expect([first.startPcbPortId, first.endPcbPortId]).toEqual([
    "pcb_port_u1_pin1",
    "pcb_port_u2_pin1",
  ])
  expect([second.startPcbPortId, second.endPcbPortId]).toEqual([
    "pcb_port_u1_pin2",
    "pcb_port_u2_pin6",
  ])
  expect(
    Math.abs(getRouteLength(first.route) - getRouteLength(second.route)),
  ).toBeLessThanOrEqual(0.05)
  expect(outputRoutes).not.toEqual(originalRoutes)
})
