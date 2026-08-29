import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import {
  CapacityMeshRoutingAnalysisSolver,
  type SimpleRouteJson,
} from "../../lib/index"

const fixtureUrl = new URL(
  "./assets/am625sip-linux-board.simple-route.json.gz",
  import.meta.url,
)
const simpleRouteJson = JSON.parse(
  gunzipSync(readFileSync(fixtureUrl)).toString(),
) as SimpleRouteJson

test("estimates AM625SIP capacity demand without requiring a physical route", () => {
  const solver = new CapacityMeshRoutingAnalysisSolver(simpleRouteJson)

  solver.solve()
  const output = solver.getOutput()

  expect(solver.failed).toBeFalse()
  expect(solver.getCurrentPhase()).toBe("done")
  expect(solver.capacityPathingSolver?.getCapacityPaths()).toHaveLength(432)
  expect(output.length).toBeGreaterThan(0)
  expect(
    Math.max(...output.map((node) => node.portPoints.length)),
  ).toBeGreaterThan(1)
  expect(output.every((node) => node.availableZ?.length)).toBeTrue()
  expect(
    output.some((node) =>
      node.portPoints.some((point) => point.rootConnectionName),
    ),
  ).toBeTrue()
})
