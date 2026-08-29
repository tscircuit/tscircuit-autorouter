import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  applyPipeline9MutatedPreloadedSections,
  preparePipeline9MutatedPreloadedSections,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9MutatedPreloadedTraceSimplification"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import {
  createHighlightedMutationFixture,
  highlightedFirstVia,
  highlightedSecondVia,
} from "../fixtures/pipeline9-mutated-section-simplification"

test("Pipeline9 simplifies one accepted fallback region with the regular trace simplifier", () => {
  const fixture = createHighlightedMutationFixture()
  const prepared = preparePipeline9MutatedPreloadedSections({
    ...fixture,
  })

  expect(prepared.sections).toHaveLength(1)
  expect(
    prepared.sections[0]!.section.sourceRoutes.map(
      (route) => route.connectionName,
    ),
  ).toEqual([
    "source_trace_10_fixed_10_75",
    "source_trace_10_fixed_10_82",
    "source_trace_10_fixed_10_83",
    "source_trace_10_fixed_10_84",
    "source_trace_10_fixed_10_85",
  ])
  expect(prepared.sections[0]!.hdRoute.vias).toEqual([
    highlightedFirstVia,
    highlightedSecondVia,
  ])

  const solver = new TraceSimplificationSolver({
    hdRoutes: prepared.sections.map((section) => section.hdRoute),
    otherHdRoutes: prepared.immutableHdRoutes,
    obstacles: [],
    connMap: new ConnectivityMap({}),
    colorMap: {},
    defaultViaDiameter: 0.5,
    layerCount: 2,
    enableCrossingViaReduction: true,
  })
  solver.solve()

  expect(solver.failed).toBeFalse()
  expect(solver.simplifiedHdRoutes).toHaveLength(1)
  expect(solver.simplifiedHdRoutes[0]!.vias).toEqual([])
  expect(
    solver.simplifiedHdRoutes[0]!.route.every((point) => point.z === 0),
  ).toBeTrue()

  const appliedRoutes = applyPipeline9MutatedPreloadedSections({
    updatedFixedRoutes: prepared.normalizedFixedRoutes,
    sections: prepared.sections,
    simplifiedHdRoutes: solver.simplifiedHdRoutes,
  })
  expect(appliedRoutes).toHaveLength(1)
  expect(appliedRoutes[0]!.vias).toEqual([])
})
