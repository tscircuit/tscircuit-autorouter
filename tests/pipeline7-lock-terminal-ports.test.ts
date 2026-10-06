import { expect, test } from "bun:test"
import { lockHdRouteTerminals } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/lock-hd-route-terminals"
import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

type RouteFixture = {
  connectionName: string
  startX: number
  endX: number
  startPcbPortId: string
  endPcbPortId: string
}

function makeRoute({
  connectionName,
  startX,
  endX,
  startPcbPortId,
  endPcbPortId,
}: RouteFixture): HighDensityRoute {
  return {
    connectionName,
    startPcbPortId,
    endPcbPortId,
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: startX, y: 0, z: 0 },
      { x: endX, y: 0, z: 0 },
    ],
    vias: [],
  }
}

test("Pipeline7 locks direct and reversed PCB terminal endpoints", () => {
  const connections: SimpleRouteConnection[] = [
    {
      name: "direct",
      pointsToConnect: [
        { x: 0, y: 0, layer: "top", pcb_port_id: "pcb_port_a" },
        { x: 2, y: 0, layer: "top", pcb_port_id: "pcb_port_b" },
      ],
    },
    {
      name: "reversed",
      pointsToConnect: [
        { x: 10, y: 0, layer: "top", pcb_port_id: "pcb_port_c" },
        { x: 12, y: 0, layer: "top", pcb_port_id: "pcb_port_d" },
      ],
    },
  ]
  const identityRoutes = [
    makeRoute({
      connectionName: "direct",
      startX: 0.03,
      endX: 1.96,
      startPcbPortId: "pcb_port_a",
      endPcbPortId: "pcb_port_b",
    }),
    makeRoute({
      connectionName: "reversed",
      startX: 11.97,
      endX: 10.04,
      startPcbPortId: "pcb_port_d",
      endPcbPortId: "pcb_port_c",
    }),
  ]
  const [direct, reversed] = lockHdRouteTerminals({
    hdRoutes: identityRoutes,
    connections,
  })

  expect(direct?.route).toEqual([
    { x: 0, y: 0, z: 0, pcb_port_id: "pcb_port_a" },
    { x: 2, y: 0, z: 0, pcb_port_id: "pcb_port_b" },
  ])
  expect(reversed?.route).toEqual([
    { x: 12, y: 0, z: 0, pcb_port_id: "pcb_port_d" },
    { x: 10, y: 0, z: 0, pcb_port_id: "pcb_port_c" },
  ])

  const [identitySwapped] = lockHdRouteTerminals({
    hdRoutes: [
      makeRoute({
        connectionName: "direct",
        startX: 0.03,
        endX: 1.96,
        startPcbPortId: "pcb_port_b",
        endPcbPortId: "pcb_port_a",
      }),
    ],
    connections,
  })
  expect(identitySwapped!.route).toEqual([
    { x: 2, y: 0, z: 0, pcb_port_id: "pcb_port_b" },
    { x: 0, y: 0, z: 0, pcb_port_id: "pcb_port_a" },
  ])

  expect(() =>
    lockHdRouteTerminals({
      hdRoutes: [
        makeRoute({
          connectionName: "direct",
          startX: 0.03,
          endX: 1.96,
          startPcbPortId: "unknown",
          endPcbPortId: "pcb_port_b",
        }),
      ],
      connections,
    }),
  ).toThrow("route endpoint IDs do not match connection terminal IDs")
  expect(() =>
    lockHdRouteTerminals({
      hdRoutes: [
        makeRoute({
          connectionName: "missing",
          startX: 0.03,
          endX: 1.96,
          startPcbPortId: "pcb_port_a",
          endPcbPortId: "pcb_port_b",
        }),
      ],
      connections,
    }),
  ).toThrow('connection "missing" was not found')
})
