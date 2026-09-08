import { expect, test } from "bun:test"
import { createPipeline9SourceAttachmentEligibility } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9SourceAttachmentEligibility"
import { createPipeline9AssignableAttachmentInput } from "./fixtures/createPipeline9AssignableAttachmentInput"

test("empty declared aliases cannot merge competing source attachment identities", (): void => {
  for (const invalidId of ["", " ", "\t"]) {
    const originalSrj = createPipeline9AssignableAttachmentInput()
    originalSrj.connections[0]!.__rootConnectionNames = [invalidId]
    originalSrj.connections.push({
      name: "foreign-declaration",
      __rootConnectionNames: [invalidId],
      pointsToConnect: [{
        x: 6,
        y: 0,
        layer: "top",
        pcb_port_id: "foreign-terminal",
      }],
    })
    const before = structuredClone(originalSrj)
    expect((): void => {
      createPipeline9SourceAttachmentEligibility({
        originalSrj,
        containsPointInObstacleEnvelope: (): boolean => {
          const message = [
            "Invalid declared IDs must be rejected",
            "before attachment geometry is consulted",
          ].join(" ")
          throw new Error(message)
        },
      })
    }).toThrow("source attachment declarations require nonempty electrical IDs")
    expect(originalSrj).toEqual(before)
  }
})
