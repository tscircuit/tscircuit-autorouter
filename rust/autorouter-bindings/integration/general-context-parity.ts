import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { importReference } from "./tsReference"
const { CachedIntraNodeRouteSolver: ReferenceCachedIntraNodeRouteSolver } = await importReference<typeof import("../../../lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver")>("lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver.ts")
import { CachedIntraNodeRouteSolver } from "../../../lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import { loadAutorouterBindings } from "../ts/index"

type Props = ConstructorParameters<typeof CachedIntraNodeRouteSolver>[0]

await loadAutorouterBindings({ module_or_path: readFileSync(new URL("../pkg/autorouter_bindings_bg.wasm", import.meta.url)) })
const shared: Props = {
  nodeWithPortPoints: JSON.parse(readFileSync(new URL("../../intra-node-routing/integration/fixtures/srj18-12-cmn57.json", import.meta.url), "utf8")),
  cacheProvider: null,
}
const candidates = [0, 1, 2].map((seed) => {
  const props: Props = { ...shared, hyperParameters: { SHUFFLE_SEED: seed, CELL_SIZE_FACTOR: seed === 1 ? 0.5 : 1 } }
  return { expected: new ReferenceCachedIntraNodeRouteSolver(props), actual: new CachedIntraNodeRouteSolver(props, shared), finished: false }
})
while (candidates.some((candidate) => !candidate.finished)) {
  for (const candidate of candidates) {
    if (candidate.finished) continue
    const { expected, actual } = candidate
    expected.step()
    actual.step()
    assert.deepEqual([actual.iterations, actual.solved, actual.failed, actual.error, actual.progress],
      [expected.iterations, expected.solved, expected.failed, expected.error, expected.progress])
    assert.equal(JSON.stringify(actual.solvedRoutes), JSON.stringify(expected.solvedRoutes))
    if (expected.solved || expected.failed) {
      actual.dispose()
      candidate.finished = true
    }
  }
}
console.log("Shared context: interleaved candidates, distinct hyperparameters, disposal and route bytes identical")
