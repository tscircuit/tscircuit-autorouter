import { expect, test } from "bun:test"
import { getPipeline9RelativeGeometryDetails } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9RelativeGeometryDetails"
import { getPipeline9WitnessViaCertificate } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9WitnessViaCertificate"
import { relativeViaTraceExistingDefectsFixture } from "./relativeViaTraceExistingDefectsFixture"

test("detailed predicates independently bind their full old-certificate counts and exact implicated raw participants", () => {
  const input = relativeViaTraceExistingDefectsFixture()
  const certificate = getPipeline9WitnessViaCertificate(input.originalSrj, input.pointPairs, input.traces)
  const args = { original: input.originalSrj, pointPairs: input.pointPairs, traces: input.traces, certificate }
  const details = getPipeline9RelativeGeometryDetails(args)
  expect(details.srjObstacles).toHaveLength(certificate.srjObstacleViolationCount)
  for (const record of details.srjObstacles) {
    expect(record.raw.rawSegment).toHaveLength(2)
    expect(record.raw.owner.status).toBe("RESOLVED")
    expect(record.originalObstacle).toEqual(input.originalSrj.obstacles[record.originalObstacleIndex])
    expect(record.originalObstacleOwner.status).toBe("RESOLVED")
  }
  const wrongCount = structuredClone(certificate); wrongCount.srjObstacleViolationCount--
  expect(() => getPipeline9RelativeGeometryDetails({ ...args, certificate: wrongCount })).toThrow("predicates differ")
  const wrongCanonical = structuredClone(certificate); wrongCanonical.circuitJson.pop()
  expect(() => getPipeline9RelativeGeometryDetails({ ...args, certificate: wrongCanonical })).toThrow("canonical output differs")
})
