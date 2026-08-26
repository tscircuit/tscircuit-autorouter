import { expect, test } from "bun:test"
import { preparePipeline9MutatedPreloadedSections } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-mutated-preloaded-trace-simplification"
import { createHighlightedMutationFixture } from "../fixtures/pipeline9-mutated-section-simplification"

test("Pipeline9 never merges touching mutation regions from different traces", () => {
  const fixture = createHighlightedMutationFixture()
  const secondTraceRoutes = fixture.updatedFixedRoutes.map((route) => ({
    ...structuredClone(route),
    connectionName: route.connectionName.replace(
      "source_trace_10",
      "source_trace_11",
    ),
    rootConnectionName: "source_trace_11",
    preloadedTraceIndex: 11,
  }))
  const prepared = preparePipeline9MutatedPreloadedSections({
    updatedFixedRoutes: [...fixture.updatedFixedRoutes, ...secondTraceRoutes],
    regionalMutationMasks: new Map([
      ...fixture.regionalMutationMasks,
      ...secondTraceRoutes.map(
        (route) =>
          [
            route.connectionName,
            Array(route.route.length - 1).fill(true),
          ] as const,
      ),
    ]),
  })

  expect(prepared.sections).toHaveLength(2)
  expect(
    prepared.sections.map((section) => [
      ...new Set(
        section.section.sourceRoutes.map((route) => route.preloadedTraceIndex),
      ),
    ]),
  ).toEqual([[10], [11]])
})
