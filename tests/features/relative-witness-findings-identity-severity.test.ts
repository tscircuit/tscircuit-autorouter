import { expect, test } from "bun:test"
import { preservePipeline9RelativeFindings } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/preservePipeline9RelativeFindings"
import { relativeFindingPreservationFixture } from "./relativeFindingPreservationFixture"

test("same-count severity, participant, rule, message, geometry or layer changes reject preservation", () => {
  const input = relativeFindingPreservationFixture()
  for (const mutate of [
    (record: any) => { record.finding.severity += 0.000000000001 },
    (record: any) => { record.finding.key += "-different-obstacle" },
    (record: any) => { record.finding.center.x += 0.00001 },
    (record: any) => { record.finding.message = "new unrecognized finding" },
    (record: any) => { record.raw.pcb_trace_id += "-other" },
    (record: any) => { record.raw.rawSegment[0].layer = "bottom" },
    (record: any) => { record.raw.rawSegment[0].width += 0.00001 },
    (record: any) => { record.originalObstacle.connectedTo = ["other-owner"] },
    (record: any) => { record.originalObstacleOwner.owner = "other-owner" },
  ]) {
    const changed = structuredClone(input)
    mutate(changed.after.srjObstacles[0])
    expect(preservePipeline9RelativeFindings(changed).status).toBe("UNKNOWN")
  }
})
