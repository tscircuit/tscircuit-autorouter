import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { InMemoryCache } from "../../../lib/cache/InMemoryCache"
import { PortfolioSingleIntraNodeSolver } from "../../../lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { CachedIntraNodeRouteSolver } from "../../../lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import { isHighDensityCandidateSolver } from "../../../lib/bindings/high-density/highDensitySolverFactory"
import type { NodeWithPortPoints } from "../../../lib/types/high-density-types"
import { loadAutorouterBindings } from "../ts/index"

type Props = ConstructorParameters<typeof PortfolioSingleIntraNodeSolver>[0]
type Fixture = { name: string; props: Props }
type CacheCall = { action: "get" | "set"; key: string; value: string | undefined }

class ObservedCache extends InMemoryCache {
  readonly calls: CacheCall[] = []

  override getCachedSolutionSync(key: string): unknown {
    const value: unknown = super.getCachedSolutionSync(key)
    this.calls.push({ action: "get", key, value: JSON.stringify(value) })
    return value
  }

  override setCachedSolutionSync(key: string, value: unknown): void {
    this.calls.push({ action: "set", key, value: JSON.stringify(value) })
    super.setCachedSolutionSync(key, value)
  }
}

await loadAutorouterBindings({ module_or_path: readFileSync(new URL("../pkg/autorouter_bindings_bg.wasm", import.meta.url)) })
const referenceRoot = process.env.TSCIRCUIT_TS_REFERENCE
if (!referenceRoot) throw new Error("Set TSCIRCUIT_TS_REFERENCE to the frozen TypeScript checkout")
const { PortfolioSingleIntraNodeSolver: ReferencePortfolio } = await import(
  `${referenceRoot}/lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver.ts`
)

const fixtures: Fixture[] = ["srj18-12-cmn57", "srj18-16-cmn193"].map((name): Fixture => ({
  name,
  props: {
    nodeWithPortPoints: JSON.parse(readFileSync(new URL(`../../intra-node-routing/integration/fixtures/${name}.json`, import.meta.url), "utf8")) as NodeWithPortPoints,
    traceWidth: 0.15, viaDiameter: 0.3, obstacleMargin: 0.15,
  },
}))
const regression = JSON.parse(readFileSync(new URL("./fixtures/general-cmn193.json", import.meta.url), "utf8")) as Props
regression.connMap = Object.assign(new ConnectivityMap({}), regression.connMap)
fixtures.push({ name: "cmn193-fractional-power", props: regression })
for (const availableZ of [[0, 1], [0, 3]]) {
  fixtures.push({
    name: `crossing-${availableZ.join("-")}`,
    props: {
      nodeWithPortPoints: {
        capacityMeshNodeId: "x-crossing-available-z", center: { x: 0, y: 0 }, width: 6, height: 6, availableZ,
        portPoints: [
          { connectionName: "connA", x: -2.5, y: -2.5, z: 0 },
          { connectionName: "connA", x: 2.5, y: 2.5, z: 0 },
          { connectionName: "connB", x: -2.5, y: 2.5, z: 0 },
          { connectionName: "connB", x: 2.5, y: -2.5, z: 0 },
        ],
      },
      traceWidth: 0.15, viaDiameter: 0.3, effort: 1,
    },
  })
}

function cloneProps(props: Props, cacheProvider: ObservedCache): Props {
  const { connMap, cacheProvider: unusedCache, ...plain } = props
  return {
    ...structuredClone(plain), cacheProvider,
    connMap: connMap ? Object.assign(new ConnectivityMap({}), structuredClone(connMap)) : undefined,
  }
}

function solvedSegmentCount(solver: unknown): number | null {
  if (isHighDensityCandidateSolver(solver)) return solver.getSolvedSegmentCount()
  const map = (solver as { solvedConnectionsMap?: unknown }).solvedConnectionsMap
  if (!(map instanceof Map)) return null
  let count = 0
  for (const routes of map.values()) if (Array.isArray(routes)) count += routes.length
  return count
}

function snapshot(owner: PortfolioSingleIntraNodeSolver): unknown {
  const records = owner.supervisedSolvers ?? []
  return {
    iterations: owner.iterations, maxIterations: owner.MAX_ITERATIONS,
    solved: owner.solved, failed: owner.failed, error: owner.error, progress: owner.progress,
    stats: owner.stats, adaptiveSearchExpanded: owner.adaptiveSearchExpanded,
    activeIndex: records.findIndex(({ solver }) => solver === owner.activeSubSolver),
    winnerIndex: records.findIndex(({ solver }) => solver === owner.winningSolver),
    candidates: records.map(({ hyperParameters, g, h, f, solver }) => ({
      hyperParameters, g, h, f,
      iterations: solver.iterations, maxIterations: solver.MAX_ITERATIONS,
      progress: solver.progress, solved: solver.solved, failed: solver.failed, error: solver.error,
      solvedSegmentCount: solvedSegmentCount(solver),
      cacheHit: "cacheHit" in solver ? solver.cacheHit : undefined,
    })),
  }
}

function compareCaches(actual: ObservedCache, expected: ObservedCache, label: string): void {
  assert.equal(JSON.stringify(actual.calls), JSON.stringify(expected.calls), `${label}: cache operation order and bytes`)
  assert.equal(JSON.stringify([...actual.cache]), JSON.stringify([...expected.cache]), `${label}: cache contents and insertion order`)
  assert.deepEqual(
    [actual.cacheHits, actual.cacheMisses, actual.cacheHitsByPrefix, actual.cacheMissesByPrefix],
    [expected.cacheHits, expected.cacheMisses, expected.cacheHitsByPrefix, expected.cacheMissesByPrefix],
    `${label}: cache counters`,
  )
}

function stepError(owner: PortfolioSingleIntraNodeSolver): string | undefined {
  try {
    owner.step()
    return undefined
  } catch (error) {
    return String(error)
  }
}

function disposeCandidates(owner: PortfolioSingleIntraNodeSolver): void {
  for (const { solver } of owner.supervisedSolvers ?? []) {
    if (solver instanceof CachedIntraNodeRouteSolver || isHighDensityCandidateSolver(solver)) solver.dispose()
  }
}

for (const { name, props } of fixtures.filter((fixture) => !process.env.PORTFOLIO_FIXTURE || fixture.name.includes(process.env.PORTFOLIO_FIXTURE))) {
  const expectedCache = new ObservedCache()
  const actualCache = new ObservedCache()
  for (const pass of ["cold", "warm"]) {
    const expected = new ReferencePortfolio(cloneProps(props, expectedCache))
    const actual = new PortfolioSingleIntraNodeSolver(cloneProps(props, actualCache))
    try {
      while (!expected.solved && !expected.failed) {
        const retainedExpected = [...(expected.supervisedSolvers ?? [])]
        const retainedActual = [...(actual.supervisedSolvers ?? [])]
        const expectedError = stepError(expected)
        const actualError = stepError(actual)
        const label = `${name}/${pass} step ${expected.iterations}`
        assert.equal(actualError, expectedError, `${label}: thrown error`)
        for (let i = 0; i < retainedExpected.length; i++) {
          const reference = retainedExpected[i]
          const retained = retainedActual[i]!
          assert.equal(JSON.stringify([retained.g, retained.h, retained.f, retained.solver.iterations, retained.solver.solved, retained.solver.failed, retained.solver.progress]),
            JSON.stringify([reference.g, reference.h, reference.f, reference.solver.iterations, reference.solver.solved, reference.solver.failed, reference.solver.progress]), `${label}: retained candidate ${i}`)
        }
        // JSON comparison deliberately gives NaN/Infinity and undefined the
        // same representation as the adapter boundary.
        assert.equal(JSON.stringify(snapshot(actual)), JSON.stringify(snapshot(expected)), `${label}: scheduler state`)
        assert.equal(JSON.stringify(actual.solvedRoutes), JSON.stringify(expected.solvedRoutes), `${label}: route bytes`)
        compareCaches(actualCache, expectedCache, label)
        assert.equal(expectedError, undefined, `${label}: fixture must not throw`)
      }
      assert.equal(actual.solved, expected.solved, `${name}/${pass}: completion`)
      for (let i = 0; i < (expected.supervisedSolvers?.length ?? 0); i++) {
        const reference = expected.supervisedSolvers[i].solver
        const candidate = actual.supervisedSolvers![i]!.solver
        assert.equal(actual.computeG(candidate), expected.computeG(reference), `${name}/${pass}: terminal computeG ${i}`)
        assert.equal(actual.computeH(candidate), expected.computeH(reference), `${name}/${pass}: terminal computeH ${i}`)
      }
      console.log(JSON.stringify({ name, pass, steps: expected.iterations, solved: expected.solved, expanded: expected.adaptiveSearchExpanded, cacheHits: actualCache.cacheHits, cacheEntries: actualCache.cache.size }))
    } finally {
      disposeCandidates(expected)
      disposeCandidates(actual)
    }
  }
}
console.log("Native portfolio matches TS scheduling, route bytes, cache operations and warm-cache replay")
