import { expect, test } from "bun:test"
import { resolvePipeline9PreloadedTerminalAttachments } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/resolvePipeline9PreloadedTerminalAttachments"
import type { Obstacle } from "lib/types"
import { createPipeline9AssignableAttachmentInput } from "./fixtures/createPipeline9AssignableAttachmentInput"

type RuntimeOvalObstacle = Omit<Obstacle, "type"> & { type: "oval" }

test("assignable reuse requires one exact attachment and uses the largest duplicate copper width", (): void => {
  for (const geometry of [
    "distinct-attachments",
    "duplicate-clear",
    "duplicate-too-wide",
    "overlapping-fixed-owner",
    "unsupported-own-oval",
    "overlapping-assignable-oval",
    "different-layer-candidate",
  ] as const) {
    const originalSrj = createPipeline9AssignableAttachmentInput()
    const duplicate = structuredClone(originalSrj.traces![0]!)
    duplicate.pcb_trace_id = "second-existing-a-b-copper"
    const first = duplicate.route[0]!
    if (first.route_type !== "wire") {
      throw new Error("Attachment fixture requires a wire boundary")
    }
    if (geometry === "distinct-attachments") {
      first.x = 0.3
    } else if (geometry === "overlapping-fixed-owner") {
      originalSrj.obstacles.push({
        ...structuredClone(originalSrj.obstacles[0]!),
        obstacleId: "overlapping-fixed-pad",
        netIsAssignable: false,
      })
    } else if (
      geometry === "unsupported-own-oval" ||
      geometry === "overlapping-assignable-oval"
    ) {
      const oval: RuntimeOvalObstacle = {
        ...structuredClone(originalSrj.obstacles[0]!),
        obstacleId: "unsupported-assignable-oval",
        type: "oval",
      }
      if (geometry === "unsupported-own-oval") {
        originalSrj.obstacles[0] = oval as unknown as Obstacle
      } else {
        originalSrj.obstacles.push(oval as unknown as Obstacle)
      }
    } else if (geometry === "different-layer-candidate") {
      for (const point of duplicate.route) {
        if (point.route_type === "wire") point.layer = "bottom"
      }
    } else {
      first.width = geometry === "duplicate-too-wide" ? 0.3 : 0.2
      originalSrj.obstacles.push({
        obstacleId: "foreign-clearance-pad",
        type: "rect",
        center: { x: 0.2, y: 0.48 },
        width: 0.1,
        height: 0.1,
        layers: ["top"],
        connectedTo: ["foreign-fixed-net"],
      })
    }
    originalSrj.traces!.push(duplicate)
    const snapshot = structuredClone(originalSrj)
    const routingSrj = structuredClone(originalSrj)
    const output = resolvePipeline9PreloadedTerminalAttachments({
      originalSrj,
      routingSrj,
    })

    if (
      geometry === "duplicate-clear" ||
      geometry === "different-layer-candidate"
    ) {
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
    expect(output.obstacles).toBe(routingSrj.obstacles)
    expect(output.traces).toBe(routingSrj.traces)
    expect(originalSrj).toEqual(snapshot)
    expect(routingSrj).toEqual(snapshot)
  }
})
