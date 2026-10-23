import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { pinPipeline9PreloadedSectionEndpoints } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pinPipeline9PreloadedSectionEndpoints"
import { createPreloadedSeamFixture } from "../fixtures/pipeline9-preloaded-seam-fixture"

test("empty seam inspection remains explicit while nonempty and conflicting witnesses fail loud", (): void => {
  const empty = pinPipeline9PreloadedSectionEndpoints({ sourceSrj: undefined, sections: [], witnesses: [], nodes: [], viaDiameter: 0.3 })
  expect(empty.endpointCount).toBe(0)
  expect(empty.ownedConnectors).toEqual([])
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(createPreloadedSeamFixture().sourceSrj, { effort: 1, cacheProvider: null })
  const step = pipeline.pipelineDef.find((step) => step.solverName === "uniformPortDistributionSolver")!
  expect(step.getConstructorParams(pipeline)).toMatchObject([{ nodeWithPortPoints: [], immutablePortIds: new Set() }])
  expect(() => pinPipeline9PreloadedSectionEndpoints({ ...createPreloadedSeamFixture(), sourceSrj: undefined })).toThrow("source provenance for nonempty jobs")
  const input = createPreloadedSeamFixture(true)
  const section = structuredClone(input.sections[0]!)
  section.connectionName = "other-mutable" as typeof section.connectionName
  section.connection.name = section.connectionName
  input.sections.push(section)
  input.witnesses.push(...structuredClone(input.witnesses).map((witness) => ({ ...witness,
    connectionName: section.connectionName,
    sourcePortPointId: witness.endpointIndex === 0 ? "conflicting-source-port" : witness.sourcePortPointId,
  })))
  expect(() => pinPipeline9PreloadedSectionEndpoints(input)).toThrow("conflicting physical witnesses")
})
