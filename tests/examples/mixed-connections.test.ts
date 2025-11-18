import { test, expect } from "bun:test"
import * as fs from "node:fs"
import { AutoroutingPipelineSolver } from "lib/solvers/AutoroutingPipelineSolver"
import type { SimpleRouteJson } from "lib/types"
const mixedConnectionsSrj: SimpleRouteJson = JSON.parse(
  fs.readFileSync(
    "assets/mixed-connections.srj.json",
    "utf-8",
  ),
)
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import "tests/fixtures/svg-matcher"

test("mixed-connections example", async () => {
  const solver = new AutoroutingPipelineSolver(mixedConnectionsSrj)
  solver.solve()

  const simplifiedPcbTraces = solver.getOutputSimplifiedPcbTraces()

  const circuitJson = convertToCircuitJson(
    solver.srjWithPointPairs!,
    simplifiedPcbTraces,
    mixedConnectionsSrj.minTraceWidth,
  )

  const svg = convertCircuitJsonToPcbSvg(circuitJson)

  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
