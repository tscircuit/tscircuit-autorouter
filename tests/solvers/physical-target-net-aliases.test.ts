import { expect, test } from "bun:test"
import { getObstacleTargetConnectionName } from "lib/solvers/BgaTopologyGeneratorSolver/getObstacleTargetConnectionName"
import type { Obstacle, SimpleRouteJson } from "lib/types"

test("net-wide terminal aliases require a target on the physical pad layer", (): void => {
  const obstacle: Obstacle = {
    type: "rect",
    center: { x: 2, y: 3 },
    width: 0.2,
    height: 0.6,
    layers: ["bottom"],
    connectedTo: ["local-port", "remote-port", "ground"],
  }
  const srj: SimpleRouteJson = {
    layerCount: 8,
    minTraceWidth: 0.1,
    bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10 },
    obstacles: [obstacle],
    connections: [
      {
        name: "remote-ground",
        pointsToConnect: [
          { x: 8, y: 8, layer: "bottom", pcb_port_id: "remote-port" },
          { x: 9, y: 9, layer: "bottom" },
        ],
      },
      {
        name: "opposite-layer-ground",
        pointsToConnect: [
          { x: 2, y: 3, layer: "top", pointId: "local-port" },
          { x: 9, y: 9, layer: "top" },
        ],
      },
    ],
  }

  expect(getObstacleTargetConnectionName({ obstacle, srj })).toBeUndefined()
  expect(
    getObstacleTargetConnectionName({
      obstacle,
      srj: { ...srj, connections: srj.connections.slice(1) },
    }),
  ).toBeUndefined()
  srj.connections.push({
    name: "local-ground-mst",
    __rootConnectionNames: ["ground"],
    pointsToConnect: [
      {
        x: 2.1005,
        y: 3,
        layers: ["top", "bottom"],
        pcb_port_id: "local-port",
      },
      { x: 9, y: 9, layer: "bottom" },
    ],
  })
  expect(getObstacleTargetConnectionName({ obstacle, srj })).toBe("ground")
})
