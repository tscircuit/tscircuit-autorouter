import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { CachedIntraNodeRouteSolver } from "../../../lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import * as bindings from "../pkg/autorouter_bindings.js"
import { loadAutorouterBindings } from "../ts/index"

type Props = ConstructorParameters<typeof CachedIntraNodeRouteSolver>[0]

await loadAutorouterBindings({ module_or_path: readFileSync(new URL("../pkg/autorouter_bindings_bg.wasm", import.meta.url)) })
const input = JSON.parse(readFileSync(new URL("./fixtures/general-reroute-cmn0.json", import.meta.url), "utf8")) as Props
input.connMap = Object.assign(new ConnectivityMap({}), input.connMap)
const expected = new CachedIntraNodeRouteSolver({ ...input, cacheProvider: null })
const actual = new CachedIntraNodeRouteSolver({ ...input, cacheProvider: null })
// Create the lazy wrapper exactly as portfolio adoption does. The raw engine
// is exposed here only to reproduce native batches without the other candidates.
const binding = (actual as unknown as { getBinding(lazy: boolean): bindings.IntraNodeRouteSolver }).getBinding(true)
let observedSameCountRevision = false
try {
  while (!expected.solved && !expected.failed) {
    const previousCount = binding.getRouteCount()
    const previousRevision = binding.getOutputRevision()
    for (let i = 0; i < 100; i++) {
      expected.step()
      if (actual.solved || actual.failed) continue
      actual.iterations++
      const status = binding.step(actual.iterations)
      actual.solved = status % 2 === 1
      actual.failed = Math.floor(status / 2) % 2 === 1
      if (actual.failed) actual.error = binding.error() ?? null
    }
    if (binding.getRouteCount() === previousCount && binding.getOutputRevision() !== previousRevision) observedSameCountRevision = true
    actual.syncPortfolioOutput()
    assert.deepEqual([actual.iterations, actual.solved, actual.failed, actual.error], [expected.iterations, expected.solved, expected.failed, expected.error])
    assert.equal(JSON.stringify(actual.solvedRoutes), JSON.stringify(expected.solvedRoutes), `Batch ending at ${actual.iterations}`)
  }
  assert.equal(expected.solved, true)
  assert.equal(observedSameCountRevision, true, "Fixture must reroute while retaining the same batch-end route count")
  console.log("General reroute: native batches preserve changed routes despite equal batch-end counts")
} finally {
  expected.dispose()
  actual.dispose()
}
