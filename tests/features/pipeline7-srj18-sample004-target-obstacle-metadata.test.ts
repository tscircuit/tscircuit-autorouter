import { expect, test } from "bun:test"
import { createRequire } from "node:module"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"

const require = createRequire(import.meta.url)
const { dataset } = require("dataset-srj18")

const getSample004SerializedHyperGraph = () => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(dataset.sample004 as SimpleRouteJson),
    {
      cacheProvider: null,
      effort: 1,
    },
  )

  while (solver.getCurrentPhase() !== "portPointPathingSolver") {
    if (solver.failed) throw new Error(solver.error ?? "pipeline failed")
    solver.step()
  }

  while (
    !(solver.portPointPathingSolver as any)?.tinyPipelineSolver?.inputProblem
      ?.serializedHyperGraph
  ) {
    if (solver.failed) throw new Error(solver.error ?? "pipeline failed")
    solver.step()
  }

  return (solver.portPointPathingSolver as any).tinyPipelineSolver.inputProblem
    .serializedHyperGraph
}

test("Pipeline7 sample004 does not serialize target regions as unreserved full obstacles", () => {
  const hg = getSample004SerializedHyperGraph()

  expect(
    hg.regions.filter(
      (region: any) =>
        region.d?._containsObstacle === true &&
        region.d?._containsTarget === true &&
        region.d?.netId === undefined &&
        region.d?.NetId === undefined,
    ),
  ).toEqual([])

  for (const regionId of ["cmn_456", "cmn_457", "cmn_454", "cmn_455"]) {
    const region = hg.regions.find(
      (candidate: any) => candidate.regionId === regionId,
    )
    expect(region).toBeDefined()
    expect(
      region.d?._containsObstacle !== true ||
        region.d?.netId !== undefined ||
        region.d?.NetId !== undefined,
    ).toBe(true)
  }
}, 120_000)
