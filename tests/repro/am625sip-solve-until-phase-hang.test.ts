import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import {
  AutoroutingPipelineSolver,
  type SimpleRouteJson,
} from "../../lib/index"

const fixtureUrl = new URL(
  "./assets/am625sip-linux-board.simple-route.json.gz",
  import.meta.url,
)
const simpleRouteJson = JSON.parse(
  gunzipSync(readFileSync(fixtureUrl)).toString(),
) as SimpleRouteJson

test("stops when AM625SIP routing fails before the target phase", () => {
  const solver = new AutoroutingPipelineSolver(simpleRouteJson, {
    effort: 0.01,
  })

  solver.solveUntilPhase("highDensityRouteSolver")

  expect(solver.failed).toBeTrue()
  expect(solver.error).toContain("ran out of iterations")
})
