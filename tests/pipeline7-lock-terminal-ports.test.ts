import { expect, test } from "bun:test"
import { lockHdRouteTerminals } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/lock-hd-route-terminals"
import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

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
  const makeRoute = (
    connectionName: string,
    startX: number,
    endX: number,
  ): HighDensityRoute => ({
    connectionName,
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: startX, y: 0, z: 0 },
      { x: endX, y: 0, z: 0 },
    ],
    vias: [],
  })

  const [direct, reversed] = lockHdRouteTerminals(
    [makeRoute("direct", 0.03, 1.96), makeRoute("reversed", 11.97, 10.04)],
    connections,
  )

  expect(direct?.route).toEqual([
    { x: 0, y: 0, z: 0, pcb_port_id: "pcb_port_a" },
    { x: 2, y: 0, z: 0, pcb_port_id: "pcb_port_b" },
  ])
  expect(reversed?.route).toEqual([
    { x: 12, y: 0, z: 0, pcb_port_id: "pcb_port_d" },
    { x: 10, y: 0, z: 0, pcb_port_id: "pcb_port_c" },
  ])
})
