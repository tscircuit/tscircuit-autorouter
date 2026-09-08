import { expect, test } from "bun:test"
import { resolvePipeline9PreloadedTerminalAttachments } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/resolvePipeline9PreloadedTerminalAttachments"
import type { SimplifiedPcbTrace } from "lib/types"
import { createPipeline9AssignableAttachmentInput } from "./fixtures/createPipeline9AssignableAttachmentInput"

test("unknown or foreign actual source boundaries cannot authorize assignable attachment reuse", (): void => {
  for (const boundaryKind of [
    "unknown-owner",
    "missing-connects-to",
    "contradictory-tag",
    "remote-contradictory-tag",
    "wire",
    "via",
    "jumper",
    "through-obstacle",
    "other-layer-control",
    "candidate-starts-with-via",
  ] as const) {
    const originalSrj = createPipeline9AssignableAttachmentInput()
    const originalTrace = originalSrj.traces![0]!
    if (boundaryKind === "unknown-owner") {
      originalTrace.connection_name = "undeclared-owner"
    } else if (boundaryKind === "missing-connects-to") {
      delete originalTrace.connectsTo
    } else if (boundaryKind === "contradictory-tag") {
      const first = originalTrace.route[0]!
      if (first.route_type !== "wire") {
        throw new Error("Attachment fixture requires a first wire")
      }
      first.start_pcb_port_id = "port-b"
    } else if (boundaryKind === "candidate-starts-with-via") {
      originalTrace.route.unshift({
        route_type: "via",
        x: 0.2,
        y: 0.2,
        from_layer: "bottom",
        to_layer: "top",
        via_diameter: 0.3,
      })
    } else {
      originalSrj.connections.push({
        name: "foreign-net",
        pointsToConnect: [
          { x: 6, y: 0, layer: "top", pcb_port_id: "foreign-a" },
          { x: 7, y: 1, layer: "top", pcb_port_id: "foreign-b" },
        ],
      })
      let route: SimplifiedPcbTrace["route"]
      if (boundaryKind === "via") {
        route = [
          {
            route_type: "via",
            x: 0.3,
            y: 0.3,
            from_layer: "bottom",
            to_layer: "top",
            via_diameter: 0.3,
          },
        ]
      } else if (boundaryKind === "jumper") {
        route = [
          {
            route_type: "jumper",
            start: { x: 0.3, y: 0.3 },
            end: { x: 6, y: 0 },
            footprint: "0603",
            layer: "top",
          },
        ]
      } else if (boundaryKind === "through-obstacle") {
        route = [
          {
            route_type: "through_obstacle",
            start: { x: 0.3, y: 0.3 },
            end: { x: 6, y: 0 },
            width: 0.1,
            from_layer: "top",
            to_layer: "bottom",
          },
        ]
      } else {
        const layer = boundaryKind === "other-layer-control" ? "bottom" : "top"
        route = [
          {
            route_type: "wire",
            x: boundaryKind === "remote-contradictory-tag" ? 5 : 0.3,
            y: boundaryKind === "remote-contradictory-tag" ? 1 : 0.3,
            width: 0.1,
            layer,
            ...(boundaryKind === "remote-contradictory-tag"
              ? { start_pcb_port_id: "port-a" }
              : {}),
          },
          { route_type: "wire", x: 6, y: 0, width: 0.1, layer },
        ]
      }
      originalSrj.traces!.push({
        type: "pcb_trace",
        pcb_trace_id: "foreign-existing-boundary",
        connection_name: "foreign-net",
        connectsTo: ["foreign-a", "foreign-b"],
        route,
      })
    }
    const snapshot = structuredClone(originalSrj)
    const routingSrj = structuredClone(originalSrj)
    const output = resolvePipeline9PreloadedTerminalAttachments({
      originalSrj,
      routingSrj,
    })

    if (boundaryKind === "other-layer-control") {
      expect(output).not.toBe(routingSrj)
      expect(output.connections[0]!.pointsToConnect[0]).toMatchObject({
        x: 0.2,
        y: 0.2,
        layer: "top",
        pcb_port_id: "port-a",
      })
    } else {
      expect(output).toBe(routingSrj)
    }
    expect(originalSrj).toEqual(snapshot)
    expect(routingSrj).toEqual(snapshot)
    expect(output.traces).toBe(routingSrj.traces)
    expect(output.obstacles).toBe(routingSrj.obstacles)
  }
})
