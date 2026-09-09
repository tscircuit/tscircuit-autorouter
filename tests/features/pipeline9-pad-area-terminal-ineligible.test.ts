import { expect, test } from "bun:test"
import { resolvePipeline9PadAreaTerminals } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/resolvePipeline9PadAreaTerminals"
import type { Obstacle, SimplifiedPcbTrace } from "lib/types"
import { createPipeline9PadAreaTerminalInput } from "./fixtures/createPipeline9PadAreaTerminalInput"

test("pad-area normalization leaves preloaded, ambiguous and unsupported terminal domains unchanged", (): void => {
  for (const variant of [
    "preload-membership",
    "preload-point-alias",
    "preload-start-tag",
    "preload-end-tag",
    "terminal-via",
    "multilayer",
    "mixed-layer-occurrences",
    "distinct-source-positions",
    "ambiguous-own-pad",
    "assignable-own-pad",
    "copper-pour",
    "unequal-oval",
    "missing-own-pcb-membership",
    "missing-pcb-identity",
    "polygon-board",
    "already-normalized-routing-point",
    "offboard-connection",
    "offboard-point-alias",
    "external-point-group",
    "offboard-own-pad",
    "one-point-connection",
  ] as const) {
    const originalSrj = createPipeline9PadAreaTerminalInput()
    const connection = originalSrj.connections[0]!
    const point = connection.pointsToConnect[0]!
    const ownPad = originalSrj.obstacles[0]!
    if (variant.startsWith("preload-")) {
      const trace: SimplifiedPcbTrace = {
        type: "pcb_trace",
        pcb_trace_id: "original-source-copper",
        connection_name: "net-a",
        connectsTo:
          variant === "preload-membership"
            ? ["pcb-a"]
            : variant === "preload-point-alias"
              ? ["logical-a"]
              : [],
        route: [
          {
            route_type: "wire",
            x: 0.5,
            y: 0,
            width: 0.25,
            layer: "top",
            ...(variant === "preload-start-tag"
              ? { start_pcb_port_id: "pcb-a" }
              : {}),
          },
          {
            route_type: "wire",
            x: -2,
            y: 0,
            width: 0.25,
            layer: "top",
            ...(variant === "preload-end-tag"
              ? { end_pcb_port_id: "pcb-a" }
              : {}),
          },
        ],
      }
      originalSrj.traces = [trace]
    }
    switch (variant) {
      case "terminal-via":
        connection.pointsToConnect[0] = {
          ...point,
          layer: "top",
          terminalVia: { toLayer: "bottom", viaDiameter: 0.3 },
        }
        break
      case "multilayer":
        connection.pointsToConnect[0] = {
          x: point.x,
          y: point.y,
          layers: ["top", "bottom"],
          pcb_port_id: point.pcb_port_id,
          pointId: point.pointId,
        }
        break
      case "mixed-layer-occurrences":
        connection.pointsToConnect.push({ ...point, layer: "bottom" })
        break
      case "distinct-source-positions":
        connection.pointsToConnect.push({ ...point, x: 0.5 })
        break
      case "ambiguous-own-pad":
        originalSrj.obstacles.push({ ...ownPad, obstacleId: "second-own-pad" })
        break
      case "assignable-own-pad":
        ownPad.netIsAssignable = true
        break
      case "copper-pour":
        ownPad.isCopperPour = true
        break
      case "unequal-oval":
        originalSrj.obstacles[0] = {
          ...ownPad,
          type: "oval",
          height: 1,
        } as unknown as Obstacle
        break
      case "missing-own-pcb-membership":
        ownPad.connectedTo = ["net-a"]
        break
      case "missing-pcb-identity":
        delete point.pcb_port_id
        break
      case "polygon-board":
        originalSrj.outline = [
          { x: -8, y: -8 },
          { x: 8, y: -8 },
          { x: 8, y: 8 },
          { x: -8, y: 8 },
        ]
        break
      case "offboard-connection":
        connection.isOffBoard = true
        break
      case "offboard-point-alias":
        originalSrj.connections.push({
          name: "offboard-alternative",
          isOffBoard: true,
          pointsToConnect: [
            { x: point.x, y: point.y, layer: "top", pointId: "logical-a" },
            { x: -3, y: 1, layer: "top", pointId: "offboard-other" },
          ],
        })
        break
      case "external-point-group":
        connection.externallyConnectedPointIds = [["logical-a", "logical-b"]]
        break
      case "offboard-own-pad":
        ownPad.offBoardConnectsTo = ["offboard-link"]
        break
      case "one-point-connection":
        connection.pointsToConnect = [point]
        break
    }
    const routingSrj = structuredClone(originalSrj)
    if (variant === "already-normalized-routing-point") {
      routingSrj.connections[0]!.pointsToConnect[0]!.x = 0.5
    }
    const originalBefore = structuredClone(originalSrj)
    const routingBefore = structuredClone(routingSrj)
    const result = resolvePipeline9PadAreaTerminals({ originalSrj, routingSrj })
    expect(result).toBe(routingSrj)
    expect(result.connections).toBe(routingSrj.connections)
    expect(result.traces).toBe(routingSrj.traces)
    expect(originalSrj).toEqual(originalBefore)
    expect(routingSrj).toEqual(routingBefore)
  }
})
