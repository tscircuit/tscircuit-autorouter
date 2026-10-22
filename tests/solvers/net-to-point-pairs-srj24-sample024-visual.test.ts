import { expect, test } from "bun:test"
import sample024 from "@tscircuit/dataset-srj24/samples/sample024.json"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import { DisjointSet } from "lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"

test("visualize the two affected sample024 nets with their real pads", async (): Promise<void> => {
  const sourceSrj: SimpleRouteJson = sample024
  for (const connectionName of [
    "source_net_altium_pcb_378",
    "source_net_altium_pcb_385",
  ]) {
    const connection = sourceSrj.connections.find(
      (connection) => connection.name === connectionName,
    )
    if (!connection) throw new Error(`Missing sample024 net ${connectionName}`)
    const input: SimpleRouteJson = {
      ...sourceSrj,
      connections: [connection],
      obstacles: sourceSrj.obstacles.filter((obstacle) =>
        obstacle.connectedTo.includes(connectionName),
      ),
    }
    const solver = new NetToPointPairsSolver(
      input,
      {},
      getInitiallyConnectedMapFromSimpleRouteJson(input),
    )
    solver.solve()
    expect(solver.solved).toBe(true)

    const points = connection.pointsToConnect
    const connected = new DisjointSet(points)
    for (const pair of solver.newConnections) {
      connected.union(pair.pointsToConnect[0]!, pair.pointsToConnect[1]!)
    }
    const groupCount = new Set(points.map((point) => connected.find(point))).size
    const minX = Math.min(...points.map((point) => point.x))
    const maxX = Math.max(...points.map((point) => point.x))
    const minY = Math.min(...points.map((point) => point.y))
    const maxY = Math.max(...points.map((point) => point.y))
    const fontSize = Math.max(maxX - minX, maxY - minY) / 45
    const graphics: GraphicsObject = {
      ...solver.visualize(),
      rects: convertSrjToGraphicsObject(input).rects,
      texts: [
        {
          x: minX,
          y: maxY + fontSize * 6,
          anchorSide: "bottom_left",
          text: `sample024 / ${connectionName}`,
          fontSize,
        },
        {
          x: minX,
          y: maxY + fontSize * 3,
          anchorSide: "bottom_left",
          text: `${points.length} terminals / ${solver.newConnections.length} pairs / ${groupCount} groups`,
          fontSize,
        },
      ],
    }
    await expect(
      getSvgFromGraphicsObject(graphics, {
        backgroundColor: "white",
        svgWidth: 900,
        svgHeight: 900,
        hideInlineLabels: true,
      }),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: connectionName })
  }
})
