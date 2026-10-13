import {
  getFixedObstacleViolations,
  RelaxTraceClearanceSolver,
} from "@tscircuit/repair04"
import { expect, test } from "bun:test"
import type { HighDensityRoute } from "lib/types/high-density-types"

type ClearanceParams = ConstructorParameters<
  typeof RelaxTraceClearanceSolver
>[0]
type ClearanceConnection = ClearanceParams["srj"]["connections"][number]
type ClearancePoint = ClearanceConnection["pointsToConnect"][number]
type ClearanceFixtureSrj = ClearanceParams["srj"] & {
  obstacles: Array<
    ClearanceParams["srj"]["obstacles"][number] & {
      circuitJsonMetadata: {
        pcb_smtpad_id: string
        pcb_port_id?: string
      }
    }
  >
}

test("pad-boundary roundoff supplies an outward projection without moving locked contacts", (): void => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "signal",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: 0, z: 0, pcb_port_id: "start" },
        { x: 1.05, y: 1.25, z: 0 },
        { x: 0.85, y: 1.425, z: 0 },
        { x: 0.55, y: 1.383, z: 0 },
        { x: 0.55, y: 2.105, z: 0 },
        { x: 0.5, y: 2.1625, z: 0, pcb_port_id: "end" },
      ],
      vias: [],
    },
    {
      connectionName: "noncontact",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: -2, z: 0 },
        { x: 0, y: -2, z: 0 },
        { x: 1, y: -2, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "other_layer",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: 0.85, y: 1.2, z: 1 },
        { x: 0.85, y: 1.425, z: 1 },
        { x: 0.85, y: 1.65, z: 1 },
      ],
      vias: [],
    },
  ]
  const srj: ClearanceFixtureSrj = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 4 },
    obstacles: [
      {
        type: "rect",
        center: { x: 0.5, y: 2.1625 },
        width: 0.3,
        height: 1.475,
        layers: ["top"],
        connectedTo: ["signal", "end"],
        circuitJsonMetadata: { pcb_smtpad_id: "owned_pad", pcb_port_id: "end" },
      },
      {
        type: "rect",
        center: { x: 1.0000000000000142, y: 2.1625 },
        width: 0.3,
        height: 1.475,
        layers: ["top"],
        connectedTo: ["foreign"],
        circuitJsonMetadata: { pcb_smtpad_id: "foreign_pad" },
      },
    ],
    connections: routes.map(
      (route): ClearanceConnection => ({
        name: route.connectionName,
        pointsToConnect: [route.route[0]!, route.route.at(-1)!].map(
          (point): ClearancePoint => ({
            ...point,
            layer: point.z === 0 ? "top" : "bottom",
          }),
        ),
      }),
    ),
  }
  const originalSrj = structuredClone(srj)
  const originalRoutes = structuredClone(routes)
  const corner = routes[0]!.route[2]!
  const foreign = srj.obstacles[1]!
  const signedDepth = foreign.width / 2 - Math.abs(corner.x - foreign.center.x)
  expect(signedDepth).toBeLessThan(0)
  expect(signedDepth).toBeGreaterThan(-1e-10)
  const initialViolations = getFixedObstacleViolations({
    srj,
    routes,
    traceClearance: 0.1,
  })
  expect(initialViolations.length).toBeGreaterThan(0)
  expect(
    initialViolations.some(
      (violation): boolean => violation.obstacleIndex === 0,
    ),
  ).toBeFalse()
  const params: ClearanceParams = {
    srj,
    routes,
    bounds: srj.bounds,
    boundaryMargin: 0,
    traceClearance: 0.1,
    viaClearance: 0.1,
    lockedPointIndices: routes.map((route): boolean[] =>
      route.route.map((): boolean => false),
    ),
  }
  const solver = new RelaxTraceClearanceSolver(params)
  solver.solve()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  const output = solver.getOutput()
  expect(
    getFixedObstacleViolations({ srj, routes: output, traceClearance: 0.1 }),
  ).toEqual([])
  expect(output[0]!.route[2]).not.toEqual(originalRoutes[0]!.route[2])
  expect(output[0]!.route[0]).toEqual(originalRoutes[0]!.route[0])
  expect(output[0]!.route.at(-1)).toEqual(originalRoutes[0]!.route.at(-1))
  expect(output[0]!.traceThickness).toBe(0.15)
  expect(output[0]!.vias).toEqual([])
  expect(output[1]).toEqual(originalRoutes[1])
  expect(output[2]).toEqual(originalRoutes[2])
  expect(routes).toEqual(originalRoutes)
  expect(srj).toEqual(originalSrj)

  const lockedPointIndices = structuredClone(params.lockedPointIndices)
  lockedPointIndices[0]![2] = true
  const locked = new RelaxTraceClearanceSolver({
    ...params,
    lockedPointIndices,
  })
  locked.solve()
  const lockedOutput = locked.getOutput()
  expect(lockedOutput[0]!.route[2]).toEqual(originalRoutes[0]!.route[2])
  expect(
    getFixedObstacleViolations({
      srj,
      routes: lockedOutput,
      traceClearance: 0.1,
    }).length,
  ).toBeGreaterThan(0)
  expect(lockedOutput[0]!.route[0]).toEqual(originalRoutes[0]!.route[0])
  expect(lockedOutput[0]!.route.at(-1)).toEqual(originalRoutes[0]!.route.at(-1))
  expect(routes).toEqual(originalRoutes)
  expect(srj).toEqual(originalSrj)
})
