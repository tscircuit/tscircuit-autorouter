import { expect, test } from "bun:test"
import "graphics-debug/matcher"
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { PreprocessSimpleRouteJsonSolver } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/PreprocessSimpleRouteJsonSolver"
import { PreprocessSimpleRouteJsonWithoutTraceObstaclesSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/PreprocessSimpleRouteJsonWithoutTraceObstaclesSolver"
import type { SimpleRouteJson } from "lib/types"
import { getDdrPairPreflightGraphics } from "tests/fixtures/getDdrPairPreflightGraphics"

test("preprocessing admits the native AM62L input with missing pair tolerances", async (): Promise<void> => {
  const fixtureBytes = readFileSync(
    new URL(
      "../fixtures/assets/ddr-pair-preflight/sample021.srj.json",
      import.meta.url,
    ),
  )
  expect(createHash("sha256").update(fixtureBytes.toString("utf8")).digest("hex")).toBe(
    "38c774814decccc3182fdad3735e77489a0cd7a6b3770793a55ae37608ccfd67",
  )
  const inputSrj: SimpleRouteJson = JSON.parse(fixtureBytes.toString())
  const originalInput = JSON.stringify(inputSrj)
  const preflightResults = []
  for (const [label, Solver] of [
    ["Classic preprocessing", PreprocessSimpleRouteJsonSolver],
    [
      "Exact-trace preprocessing",
      PreprocessSimpleRouteJsonWithoutTraceObstaclesSolver,
    ],
  ] as const) {
    const solver = new Solver(inputSrj)
    solver.solve()
    expect(solver.failed).toBe(false)
    expect(solver.solved).toBe(true)
    expect(solver.getOutputSimpleRouteJson().differentialPairs).toEqual(
      inputSrj.differentialPairs,
    )
    preflightResults.push({
      label,
      solved: solver.solved,
      failed: solver.failed,
      error: solver.error,
    })
  }
  expect(JSON.stringify(inputSrj)).toBe(originalInput)
  await expect(
    getDdrPairPreflightGraphics({ inputSrj, preflightResults }),
  ).toMatchGraphicsSvg(import.meta.path, { backgroundColor: "white" })
})
