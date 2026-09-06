import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("trace simplification preserves distinct fragments of one connection", (): void => {
  const fragments: HighDensityRoute[] = [0, 1, 2].map(
    (index: number): HighDensityRoute => ({
      connectionName: "shared",
      ...(index === 1 ? {} : { rootConnectionName: "root" }),
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: index * 3, y: 0, z: 0, pcb_port_id: `start-${index}` },
        { x: index * 3 + 0.5, y: 0.5, z: 0 },
        { x: index * 3 + 1.5, y: 0.5, z: 0 },
        { x: index * 3 + 2, y: 0, z: 0, pcb_port_id: `end-${index}` },
      ],
      vias: [],
    }),
  )
  const immutableRoutes: HighDensityRoute[] = [
    {
      connectionName: "shared",
      rootConnectionName: "root",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: -2, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "shared_simplification_fragment_0",
      rootConnectionName: "foreign-root",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: -1, z: 0 },
        { x: 8, y: -1, z: 0 },
      ],
      vias: [],
    },
  ]
  for (const reversed of [false, true]) {
    const inputRoutes: HighDensityRoute[] = reversed
      ? [...fragments].reverse().map(
          (route: HighDensityRoute): HighDensityRoute => ({
            ...route,
            route: [...route.route].reverse(),
          }),
        )
      : fragments
    const connMap: ConnectivityMap = new ConnectivityMap({
      common: ["shared", "root"],
      foreign: ["shared_simplification_fragment_0", "foreign-root"],
    })
    const inputSnapshot: HighDensityRoute[] = structuredClone(inputRoutes)
    const immutableSnapshot: HighDensityRoute[] =
      structuredClone(immutableRoutes)
    const connectivitySnapshot: Record<string, string> = {
      ...connMap.idToNetMap,
    }
    const solver: TraceSimplificationSolver = new TraceSimplificationSolver({
      hdRoutes: inputRoutes,
      otherHdRoutes: immutableRoutes,
      obstacles: [],
      connMap,
      colorMap: {},
      defaultViaDiameter: 0.3,
      layerCount: 2,
      preserveRouteEndpoints: true,
    })

    solver.solve()

    expect(solver.failed).toBeFalse()
    expect(solver.solved).toBeTrue()
    const output: HighDensityRoute[] = solver.simplifiedHdRoutes
    expect(output).toHaveLength(inputRoutes.length)
    for (let index: number = 0; index < inputRoutes.length; index++) {
      expect(output[index]!.connectionName).toBe(
        inputRoutes[index]!.connectionName,
      )
      expect(output[index]!.rootConnectionName).toBe(
        inputRoutes[index]!.rootConnectionName,
      )
      expect(output[index]!.route[0]).toEqual(inputRoutes[index]!.route[0])
      expect(output[index]!.route.at(-1)).toEqual(
        inputRoutes[index]!.route.at(-1),
      )
      expect(output[index]!.route.length).toBeLessThan(
        inputRoutes[index]!.route.length,
      )
    }
    expect(inputRoutes).toEqual(inputSnapshot)
    expect(immutableRoutes).toEqual(immutableSnapshot)
    expect(connMap.idToNetMap).toEqual(connectivitySnapshot)
  }
})
