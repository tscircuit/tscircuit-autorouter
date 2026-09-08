import { expect, test } from "bun:test"
import { resolvePipeline9PreloadedTerminalAttachments } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/resolvePipeline9PreloadedTerminalAttachments"
import type { Obstacle } from "lib/types"
import { createPipeline9PreloadAttachmentInput } from "./fixtures/createPipeline9PreloadAttachmentInput"

type RuntimeOvalObstacle = Omit<Obstacle, "type"> & { type: "oval" }

test("ineligible preload boundaries leave logical routing targets unchanged", (): void => {
  for (const reason of [
    "foreign-net",
    "different-layer",
    "contradictory-tag",
    "contradictory-end-tag",
    "foreign-copper",
    "start-via-boundary",
    "end-via-boundary",
    "no-boundary-in-pad",
    "no-preload",
    "no-own-pad",
    "ambiguous-own-pad",
    "unsupported-own-oval",
    "overlapping-rect-and-oval",
    "rotated-outside",
    "conflicting-logical-positions",
    "multilayer-terminal",
    "terminal-via",
  ] as const) {
    const originalSrj = createPipeline9PreloadAttachmentInput()
    const trace = originalSrj.traces![0]!
    const first = trace.route[0]!
    const last = trace.route[trace.route.length - 1]!
    if (first.route_type !== "wire" || last.route_type !== "wire") {
      throw new Error("Attachment fixture requires wire boundaries")
    }
    if (reason === "foreign-net") {
      trace.connectsTo = ["foreign-a", "foreign-b"]
      first.start_pcb_port_id = "foreign-a"
      last.end_pcb_port_id = "foreign-b"
    } else if (reason === "different-layer") {
      first.layer = "bottom"
      last.layer = "bottom"
    } else if (reason === "contradictory-tag") {
      first.start_pcb_port_id = "port-b"
    } else if (reason === "contradictory-end-tag") {
      trace.route.reverse()
      first.end_pcb_port_id = "port-b"
    } else if (reason === "foreign-copper") {
      originalSrj.obstacles.push({
        obstacleId: "foreign-pad",
        type: "rect",
        center: { x: 0.2, y: 0.2 },
        width: 0.2,
        height: 0.2,
        layers: ["top"],
        connectedTo: ["foreign-net"],
      })
    } else if (
      reason === "start-via-boundary" ||
      reason === "end-via-boundary"
    ) {
      trace.route.unshift({
        route_type: "via",
        x: first.x,
        y: first.y,
        from_layer: reason === "start-via-boundary" ? "bottom" : "top",
        to_layer: reason === "start-via-boundary" ? "top" : "bottom",
        via_diameter: 0.3,
      })
      delete first.start_pcb_port_id
      delete last.end_pcb_port_id
      if (reason === "end-via-boundary") trace.route.reverse()
    } else if (reason === "no-boundary-in-pad") {
      first.x = 1
    } else if (reason === "no-preload") {
      originalSrj.traces = []
    } else if (reason === "no-own-pad") {
      originalSrj.obstacles = []
    } else if (reason === "ambiguous-own-pad") {
      const secondPad = structuredClone(originalSrj.obstacles[0]!)
      secondPad.obstacleId = "second-terminal-pad"
      originalSrj.obstacles.push(secondPad)
    } else if (
      reason === "unsupported-own-oval" ||
      reason === "overlapping-rect-and-oval"
    ) {
      const oval: RuntimeOvalObstacle = {
        ...originalSrj.obstacles[0]!,
        obstacleId: "unsupported-terminal-oval",
        type: "oval",
      }
      if (reason === "unsupported-own-oval") {
        originalSrj.obstacles[0] = oval as unknown as Obstacle
      } else {
        originalSrj.obstacles.push(oval as unknown as Obstacle)
      }
    } else if (reason === "rotated-outside") {
      originalSrj.obstacles[0]!.height = 0.2
      originalSrj.obstacles[0]!.ccwRotationDegrees = 90
      first.y = 0
    } else if (reason === "conflicting-logical-positions") {
      originalSrj.connections[1]!.pointsToConnect[0]!.x = -0.1
    } else {
      for (const connection of originalSrj.connections) {
        const point = connection.pointsToConnect[0]!
        if (reason === "multilayer-terminal") {
          connection.pointsToConnect[0] = {
            x: point.x,
            y: point.y,
            pcb_port_id: point.pcb_port_id,
            pointId: point.pointId,
            layers: ["top", "bottom"],
          }
        } else if ("layer" in point) {
          point.terminalVia = { toLayer: "bottom" }
        }
      }
    }
    const routingSrj = structuredClone(originalSrj)
    const originalSnapshot = structuredClone(originalSrj)
    const routingSnapshot = structuredClone(routingSrj)
    const output = resolvePipeline9PreloadedTerminalAttachments({
      originalSrj,
      routingSrj,
    })

    expect(output).toBe(routingSrj)
    expect(output).toEqual(routingSnapshot)
    expect(originalSrj).toEqual(originalSnapshot)
    expect(routingSrj).toEqual(routingSnapshot)
  }
})
