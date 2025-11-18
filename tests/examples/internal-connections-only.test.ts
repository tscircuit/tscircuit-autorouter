import { test, expect } from "bun:test"
import { AutoroutingPipelineSolver } from "lib/solvers/AutoroutingPipelineSolver"
import * as fs from "node:fs"
import type { SimpleRouteJson } from "lib/types"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import "tests/fixtures/svg-matcher"

test("internal-connections-only example", async () => {
  const internalConnectionsOnlySrj: SimpleRouteJson = JSON.parse(fs.readFileSync("examples/features/internal-connections-only/assets/internal-connections-only.srj.json", "utf-8"))
  const solver = new AutoroutingPipelineSolver(internalConnectionsOnlySrj)
  solver.solve()

  const simplifiedPcbTraces = solver.getOutputSimplifiedPcbTraces()

  const circuitJson = convertToCircuitJson(
    solver.srjWithPointPairs!,
    simplifiedPcbTraces,
    internalConnectionsOnlySrj.minTraceWidth,
  )

  const svg = convertCircuitJsonToPcbSvg(circuitJson)

  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
