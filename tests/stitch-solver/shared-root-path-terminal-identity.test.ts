import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("shared-root terminal paths rebind borrowed identity without changing sibling copper", (): void => {
  const connections: SimpleRouteConnection[] = [
    {
      name: "main",
      __rootConnectionNames: ["shared-net"],
      pointsToConnect: [
        { x: 0, y: 0, layer: "top", pcb_port_id: "main-start" },
        { x: 5, y: 0, layer: "bottom", pcb_port_id: "main-end" },
      ],
    },
    {
      name: "sibling",
      __rootConnectionNames: ["shared-net"],
      pointsToConnect: [
        { x: 1, y: 0, layer: "top", pcb_port_id: "sibling-start" },
        { x: 4, y: 0, layer: "bottom", pcb_port_id: "sibling-end" },
      ],
    },
    {
      name: "stub",
      __rootConnectionNames: ["shared-net"],
      pointsToConnect: [
        { x: 10, y: 0, layer: "top" },
        { x: 11, y: 0, layer: "top" },
      ],
    },
  ]
  const hdRoutes: HighDensityIntraNodeRoute[] = [
    {
      connectionName: "main",
      rootConnectionName: "shared-net",
      startPcbPortId: "main-start",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 0, z: 0, pcb_port_id: "main-start" },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "main",
      rootConnectionName: "shared-net",
      endPcbPortId: "main-end",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: 4, y: 0, z: 1 },
        { x: 5, y: 0, z: 1, pcb_port_id: "main-end" },
      ],
      vias: [],
    },
    {
      connectionName: "sibling",
      rootConnectionName: "shared-net",
      startPcbPortId: "sibling-start",
      endPcbPortId: "sibling-end",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: 1, y: 0, z: 0, pcb_port_id: "sibling-start" },
        { x: 2, y: 0, z: 0 },
        { x: 2, y: 0, z: 1 },
        { x: 4, y: 0, z: 1, pcb_port_id: "sibling-end" },
      ],
      vias: [{ x: 2, y: 0 }],
    },
    {
      connectionName: "stub",
      rootConnectionName: "shared-net",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: 10, y: 0, z: 0 },
        { x: 11, y: 0, z: 0 },
      ],
      vias: [],
    },
  ]
  const originalHdRoutes = structuredClone(hdRoutes)

  for (const orderedRoutes of [hdRoutes, [...hdRoutes].reverse()]) {
    const solver = new MultipleHighDensityRouteStitchSolver3({
      connections,
      hdRoutes: orderedRoutes,
      layerCount: 2,
      preserveTerminalPcbPortIds: true,
      validateTerminalContacts: true,
      preferSameLayerTerminalEndpoints: true,
    })
    solver.solve()

    expect(solver.solved).toBeTrue()
    expect(solver.failed).toBeFalse()
    const mainRoute = solver.mergedHdRoutes.find(
      (route): boolean => route.connectionName === "main",
    )!
    expect(mainRoute.startPcbPortId).toBe("main-start")
    expect(mainRoute.endPcbPortId).toBe("main-end")
    expect(
      mainRoute.route.map(
        ({ x, y, z }): { x: number; y: number; z: number } => ({ x, y, z }),
      ),
    ).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 2, y: 0, z: 1 },
      { x: 4, y: 0, z: 1 },
      { x: 5, y: 0, z: 1 },
    ])
    expect(mainRoute.vias).toEqual([{ x: 2, y: 0 }])
    expect(
      mainRoute.route.some(
        (point): boolean => point.pcb_port_id?.startsWith("sibling-") === true,
      ),
    ).toBeFalse()
    const siblingRoute = solver.mergedHdRoutes.find(
      (route): boolean => route.connectionName === "sibling",
    )!
    expect(siblingRoute.startPcbPortId).toBe("sibling-start")
    expect(siblingRoute.endPcbPortId).toBe("sibling-end")
    expect(siblingRoute.route.at(-1)?.pcb_port_id).toBe("sibling-end")
    expect(siblingRoute.vias).toEqual(originalHdRoutes[2]!.vias)
    expect(hdRoutes).toEqual(originalHdRoutes)
  }

  const invalidOwnerRoute = new MultipleHighDensityRouteStitchSolver3({
    connections: [connections[0]!],
    hdRoutes: [
      {
        ...hdRoutes[0]!,
        startPcbPortId: "unknown-terminal",
        endPcbPortId: "main-end",
        route: [hdRoutes[0]!.route[0]!, hdRoutes[1]!.route.at(-1)!],
      },
    ],
    layerCount: 2,
    preserveTerminalPcbPortIds: true,
    validateTerminalContacts: true,
  })
  expect((): void => invalidOwnerRoute.solve()).toThrow(
    'found unknown PCB terminal "unknown-terminal"',
  )
})
