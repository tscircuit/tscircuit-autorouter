import { expect, test } from "bun:test"
import { resolvePipeline9PreloadedTerminalAttachments } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/resolvePipeline9PreloadedTerminalAttachments"
import { createPipeline9PreloadAttachmentInput } from "./fixtures/createPipeline9PreloadAttachmentInput"

test("existing preload attachments retain port identity across wire and connection ordering", (): void => {
  for (const reverseRoute of [false, true]) {
    for (const reverseConnectsTo of [false, true]) {
      for (const includeEndpointTags of [false, true]) {
        const originalSrj = createPipeline9PreloadAttachmentInput()
        const trace = originalSrj.traces![0]!
        if (reverseRoute) {
          trace.route.reverse()
          const first = trace.route[0]!
          const last = trace.route[trace.route.length - 1]!
          if (first.route_type !== "wire" || last.route_type !== "wire") {
            throw new Error("Attachment fixture requires wire boundaries")
          }
          delete first.end_pcb_port_id
          delete last.start_pcb_port_id
          first.start_pcb_port_id = "port-b"
          last.end_pcb_port_id = "port-a"
        }
        if (reverseConnectsTo) trace.connectsTo!.reverse()
        if (!includeEndpointTags) {
          for (const point of trace.route) {
            if (point.route_type !== "wire") continue
            delete point.start_pcb_port_id
            delete point.end_pcb_port_id
          }
        }
        const routingSrj = structuredClone(originalSrj)
        const originalSnapshot = structuredClone(originalSrj)
        const routingSnapshot = structuredClone(routingSrj)
        const copperJson = JSON.stringify(originalSrj.traces)

        const output = resolvePipeline9PreloadedTerminalAttachments({
          originalSrj,
          routingSrj,
        })

        expect(output).not.toBe(routingSrj)
        expect(output.connections).toHaveLength(2)
        for (let index = 0; index < output.connections.length; index++) {
          const connection = output.connections[index]!
          const originalConnection = routingSnapshot.connections[index]!
          expect(connection.name).toBe(originalConnection.name)
          expect(connection.pointsToConnect[0]).toEqual({
            ...originalConnection.pointsToConnect[0],
            x: 0.2,
            y: 0.2,
          })
          expect(connection.pointsToConnect[1]).toEqual(
            originalConnection.pointsToConnect[1],
          )
        }
        expect(output.traces).toBe(routingSrj.traces)
        expect(output.obstacles).toBe(routingSrj.obstacles)
        expect(JSON.stringify(output.traces)).toBe(copperJson)
        expect(originalSrj).toEqual(originalSnapshot)
        expect(routingSrj).toEqual(routingSnapshot)
      }
    }
  }
})
