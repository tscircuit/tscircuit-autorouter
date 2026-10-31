import { expect, test } from "bun:test"
import { preservePipeline9RelativeFindings } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/preservePipeline9RelativeFindings"
import { relativeFindingPreservationFixture } from "./relativeFindingPreservationFixture"

test("full finding collection order may change but duplicate multiplicity and identities cannot", () => {
  const input = relativeFindingPreservationFixture()
  input.after.srjObstacles.reverse()
  expect(preservePipeline9RelativeFindings(input).status).toBe("PASS")
  input.after.srjObstacles[1] = structuredClone(input.after.srjObstacles[0]!)
  expect(preservePipeline9RelativeFindings(input).status).toBe("UNKNOWN")
  const missing = relativeFindingPreservationFixture()
  missing.after.srjObstacles.pop()
  missing.candidate.srjObstacleViolationCount--
  expect(preservePipeline9RelativeFindings(missing).status).toBe("UNKNOWN")
})
