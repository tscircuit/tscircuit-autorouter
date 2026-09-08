import { expect, test } from "bun:test"
import { resolvePipeline9PreloadedTerminalAttachments } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/resolvePipeline9PreloadedTerminalAttachments"
import { createPipeline9PreloadAttachmentInput } from "./fixtures/createPipeline9PreloadAttachmentInput"

test("ambiguous attachment positions stay unchanged while exact duplicate positions coalesce", (): void => {
  for (const duplicatePosition of [false, true]) {
    for (const reverseTraces of [false, true]) {
      const originalSrj = createPipeline9PreloadAttachmentInput()
      const secondTrace = structuredClone(originalSrj.traces![0]!)
      secondTrace.pcb_trace_id = "another-established-a-b-copper"
      const first = secondTrace.route[0]!
      if (first.route_type !== "wire") {
        throw new Error("Attachment fixture requires a first wire boundary")
      }
      if (!duplicatePosition) first.x = 0.3
      originalSrj.traces!.push(secondTrace)
      if (reverseTraces) originalSrj.traces!.reverse()
      const routingSrj = structuredClone(originalSrj)
      const originalSnapshot = structuredClone(originalSrj)
      const routingSnapshot = structuredClone(routingSrj)
      const output = resolvePipeline9PreloadedTerminalAttachments({
        originalSrj,
        routingSrj,
      })

      if (duplicatePosition) {
        expect(output).not.toBe(routingSrj)
        for (const connection of output.connections) {
          expect(connection.pointsToConnect[0]).toMatchObject({
            x: 0.2,
            y: 0.2,
            layer: "top",
            pcb_port_id: "port-a",
            pointId: "logical-a",
          })
        }
      } else {
        expect(output).toBe(routingSrj)
        expect(output).toEqual(routingSnapshot)
      }
      expect(output.traces).toBe(routingSrj.traces)
      expect(originalSrj).toEqual(originalSnapshot)
      expect(routingSrj).toEqual(routingSnapshot)
    }
  }
})
