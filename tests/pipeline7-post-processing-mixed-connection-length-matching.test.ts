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

test("Pipeline7 length matches the mixed-selector Core fixture", () => {
  const createPad = (x: number, y: number, connectedTo: string[] = []) => ({
    type: "rect" as const,
    layers: ["top"],
    center: { x, y },
    width: 0.54,
    height: 0.64,
    connectedTo,
  })
  const params = {
    hdRoutes: [
      {
        connectionName: "source_trace_1",
        rootConnectionName: "source_trace_1",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          {
            x: 5.49,
            y: 2,
            z: 0,
            traceThickness: 0.15,
            pcb_port_id: "pcb_port_6",
          },
          {
            x: 4.959882004456018,
            y: 1.4698820044560181,
            z: 0,
            traceThickness: 0.15,
          },
          {
            x: -3.979882004456018,
            y: 1.4698820044560181,
            z: 0,
            traceThickness: 0.15,
          },
          {
            x: -3.979882004456018,
            y: 1.4698820044560184,
            z: 0,
            traceThickness: 0.15,
          },
          {
            x: -4.51,
            y: 2,
            z: 0,
            traceThickness: 0.15,
            pcb_port_id: "pcb_port_2",
          },
        ],
        vias: [],
        jumpers: [],
      },
      {
        connectionName: "source_trace_0",
        rootConnectionName: "source_trace_0",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          {
            x: 5.49,
            y: -2,
            z: 0,
            traceThickness: 0.15,
            pcb_port_id: "pcb_port_4",
          },
          {
            x: 4.929664934965422,
            y: -1.4396649349654222,
            z: 0,
            traceThickness: 0.15,
          },
          {
            x: -5.949664934965422,
            y: -1.4396649349654222,
            z: 0,
            traceThickness: 0.15,
          },
          {
            x: -5.949664934965422,
            y: -1.4396649349654222,
            z: 0,
            traceThickness: 0.15,
          },
          {
            x: -6.51,
            y: -2,
            z: 0,
            traceThickness: 0.15,
            pcb_port_id: "pcb_port_0",
          },
        ],
        vias: [],
        jumpers: [],
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
      createPad(-6.51, -2, ["source_trace_0"]),
      createPad(-5.49, -2),
      createPad(-4.51, 2, ["source_trace_1"]),
      createPad(-3.49, 2),
      createPad(5.49, -2, ["source_trace_0"]),
      createPad(6.51, -2),
      createPad(5.49, 2, ["source_trace_1"]),
      createPad(6.51, 2),
    ],
    bounds: { minX: -10, maxX: 10, minY: -5, maxY: 5 },
    layerCount: 2,
    obstacleMargin: 0.1,
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
  expect(
    Math.abs(getRouteLength(first.route) - getRouteLength(second.route)),
  ).toBeLessThanOrEqual(0.05)
  expect(outputRoutes).not.toEqual(originalRoutes)
})
