import { expect, test } from "bun:test"
import { resolvePipeline9PreloadedTerminalAttachments } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/resolvePipeline9PreloadedTerminalAttachments"
import { createPipeline9AssignableAttachmentInput } from "./fixtures/createPipeline9AssignableAttachmentInput"

test("source-proven assignable attachments retain copper and identity in either wire orientation", (): void => {
  for (const reverseRoute of [false, true]) {
    for (const reverseConnectsTo of [false, true]) {
      for (const includeTags of [false, true]) {
        const originalSrj = createPipeline9AssignableAttachmentInput()
        const trace = originalSrj.traces![0]!
        originalSrj.connections[0]!.__rootConnectionNames = ["declared-root"]
        trace.connection_name = "declared-root"
        if (reverseRoute) trace.route.reverse()
        if (reverseConnectsTo) trace.connectsTo!.reverse()
        const first = trace.route[0]!
        const last = trace.route.at(-1)!
        if (first.route_type !== "wire" || last.route_type !== "wire") {
          throw new Error("Assignable attachment fixture requires wire ends")
        }
        if (includeTags) {
          first.start_pcb_port_id = reverseRoute ? "port-b" : "port-a"
          last.end_pcb_port_id = reverseRoute ? "port-a" : "port-b"
        }
        const originalSnapshot = structuredClone(originalSrj)
        const routingSrj = structuredClone(originalSrj)
        const routingSnapshot = structuredClone(routingSrj)
        const copperJson = JSON.stringify(originalSrj.traces)
        const obstaclesJson = JSON.stringify(originalSrj.obstacles)
        const output = resolvePipeline9PreloadedTerminalAttachments({
          originalSrj,
          routingSrj,
        })

        expect(output).not.toBe(routingSrj)
        expect(output.connections[0]!.pointsToConnect[0]).toEqual({
          ...originalSrj.connections[0]!.pointsToConnect[0],
          x: 0.2,
          y: 0.2,
        })
        expect(output.connections[0]!.pointsToConnect.slice(1)).toEqual(
          routingSnapshot.connections[0]!.pointsToConnect.slice(1),
        )
        expect(output.traces).toBe(routingSrj.traces)
        expect(output.obstacles).toBe(routingSrj.obstacles)
        expect(JSON.stringify(output.traces)).toBe(copperJson)
        expect(JSON.stringify(output.obstacles)).toBe(obstaclesJson)
        expect(originalSrj).toEqual(originalSnapshot)
        expect(routingSrj).toEqual(routingSnapshot)
      }
    }
  }
})
