import assert from "node:assert/strict"
import { routeBus as routeBefore } from "/workspace/fanout-plane-layout-repro-2422/lib/route-bus"
import { routeBus as routeAfter } from "/workspace/fanout-plane-layout-fix-2422/lib/route-bus"
import { FanoutSolver as BeforeSolver } from "/workspace/fanout-plane-layout-repro-2422/lib/fanout-solver"
import { FanoutSolver as AfterSolver } from "/workspace/fanout-plane-layout-fix-2422/lib/fanout-solver"
import { createIcepiPlaneDrop } from "/workspace/fanout-plane-layout-repro-2422/tests/fixtures/icepi-plane-drop"
import { createIcepiSinglePlaneDrop } from "/workspace/fanout-plane-layout-repro-2422/tests/fixtures/icepi-single-plane-drop"
import { createLayeredWindingChannelFixture } from "/workspace/fanout-plane-layout-fix-2422/tests/fixtures/layered-winding-channel"

const reports = []
const native = createIcepiPlaneDrop()
const sourcePath = [
  { x: native.bus.connections[0].sourcePoint.x, y: native.bus.connections[0].sourcePoint.y },
  { x: 1.2399999999987585, y: 15.079999999999984 },
  { x: 1.7399999999987577, y: 15.079999999999984 },
]
for (const [name, params] of [
  ["native-default-plane-plan", native],
  ["native-fixed-plane-plan", {
    ...native,
    fixedViaPointsByConnectionIndex: new Map([[0, sourcePath[2]]]),
    sourceEscapePaths: new Map([[0, sourcePath]]),
  }],
]) {
  const before = routeBefore(structuredClone(params))
  const after = routeAfter(structuredClone(params))
  assert(before?.length)
  assert.deepStrictEqual(after, before)
  reports.push({ name, completePlanObjectsEqual: true, sha256: new Bun.CryptoHasher("sha256").update(JSON.stringify(before)).digest("hex") })
}
const selected = createIcepiSinglePlaneDrop()
const cases = [{ name: "native-complete-plane-output", input: selected.routeParams.srj, options: selected.solverOptions }]
for (const includeTargetLayers of [false, true]) {
  const fixture = createLayeredWindingChannelFixture({ includeTargetLayers })
  cases.push({
    name: includeTargetLayers ? "layered-corner-boundary-output" : "ordinary-corner-boundary-output",
    input: fixture.simpleRouteJson,
    options: {
      buses: [fixture.bus], sharedBoundary: fixture.sharedBoundary,
      escapeLayers: ["inner1", "inner2"], compactBusTracks: true,
      allowBlindAndBuriedVias: false,
    },
  })
}
for (const fixture of cases) {
  const before = new BeforeSolver(structuredClone(fixture.input), structuredClone(fixture.options))
  const after = new AfterSolver(structuredClone(fixture.input), structuredClone(fixture.options))
  before.solve()
  after.solve()
  assert(before.solved && after.solved, `${fixture.name} must solve in both versions`)
  const beforeOutput = before.getOutput()
  const afterOutput = after.getOutput()
  assert.deepStrictEqual(afterOutput, beforeOutput)
  reports.push({ name: fixture.name, completeOutputObjectsEqual: true, sha256: new Bun.CryptoHasher("sha256").update(JSON.stringify(beforeOutput)).digest("hex") })
}
console.log(JSON.stringify(reports, null, 2))
await Bun.write("/tmp/plane-layout-equivalence-2422.json", JSON.stringify(reports, null, 2))
