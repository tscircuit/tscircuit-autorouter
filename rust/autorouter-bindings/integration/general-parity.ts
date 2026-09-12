import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { InMemoryCache } from "../../../lib/cache/InMemoryCache"
import { importReference } from "./tsReference"
const { CachedIntraNodeRouteSolver: ReferenceCachedIntraNodeRouteSolver } = await importReference<typeof import("../../../lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver")>("lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver.ts")
import { CachedIntraNodeRouteSolver } from "../../../lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import { loadAutorouterBindings } from "../ts/index"
import type { NodeWithPortPoints } from "../../../lib/types/high-density-types"

type Props = ConstructorParameters<typeof CachedIntraNodeRouteSolver>[0]
type Fixture = { name: string; props: Props }

await loadAutorouterBindings({ module_or_path: readFileSync(new URL("../pkg/autorouter_bindings_bg.wasm", import.meta.url)) })
const fixtures: Fixture[] = ["srj18-12-cmn57", "srj18-16-cmn193"].map((name): Fixture => ({
  name, props: { nodeWithPortPoints: JSON.parse(readFileSync(new URL(`../../intra-node-routing/integration/fixtures/${name}.json`, import.meta.url), "utf8")) as NodeWithPortPoints },
}))
const regression = JSON.parse(readFileSync(new URL("./fixtures/general-cmn193.json", import.meta.url), "utf8")) as Props
regression.connMap = Object.assign(new ConnectivityMap({}), regression.connMap)
fixtures.push({ name: "cmn193-fractional-power", props: regression })
for (const { name, props: input } of fixtures) {
  const expectedCache = new InMemoryCache()
  const actualCache = new InMemoryCache()
  const props = { ...input, cacheProvider: expectedCache }
  const expected = new ReferenceCachedIntraNodeRouteSolver(props)
  const actual = new CachedIntraNodeRouteSolver({ ...props, cacheProvider: actualCache })
  while (!expected.solved && !expected.failed) {
    expected.step()
    actual.step()
    assert.deepEqual([actual.iterations, actual.solved, actual.failed, actual.error, actual.progress],
      [expected.iterations, expected.solved, expected.failed, expected.error, expected.progress], `${name} step ${expected.iterations}`)
    assert.equal(JSON.stringify(actual.solvedRoutes), JSON.stringify(expected.solvedRoutes), `${name} routes at ${expected.iterations}`)
  }
  const cachedExpected = new ReferenceCachedIntraNodeRouteSolver(props)
  const cachedActual = new CachedIntraNodeRouteSolver({ ...props, cacheProvider: actualCache })
  cachedExpected.solve()
  cachedActual.solve()
  assert.equal(cachedActual.cacheHit, true)
  assert.equal(cachedActual.iterations, cachedExpected.iterations)
  assert.equal(JSON.stringify(cachedActual.solvedRoutes), JSON.stringify(cachedExpected.solvedRoutes))
  assert.equal(cachedActual.error, cachedExpected.error)
  assert.deepEqual(actualCache.cache, expectedCache.cache)
  cachedActual.dispose()
  actual.dispose()
  console.log(`${name}: ${expected.iterations} WASM steps identical`)
}
