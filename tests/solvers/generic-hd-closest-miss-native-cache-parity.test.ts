import { test, expect } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Node } from "../../lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as NativeSolver } from "../../lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

type ClosestPrivateState = { closestFuturePointCacheCoordinates: Float64Array;
  closestFuturePointCacheIndices: Int32Array; cachedFutureConnectionPointCount: number }
const routePath = fileURLToPath(new URL("../../lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost.ts", import.meta.url))
const scannerPath = fileURLToPath(new URL("../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/generic-hd-closest-point/scanClosestFuturePointMiss.ts", import.meta.url))

test("isolated miss kernel leaves native256 cache rows, references and mutation stickiness exact", async () => {
  const directory = await mkdtemp(join(tmpdir(), "generic-closest-native-cache-"))
  const source = await Bun.file(routePath).text()
  const begin = source.indexOf("    let minDist = Infinity")
  const end = source.indexOf("    // A fixed workspace avoids retaining every explored coordinate in large")
  expect(begin).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(begin)
  const replacement = `    const miss=scanClosestFuturePointMiss(this,node,isolatedContext)
    const closestPoint=miss.point,closestPointIndex=miss.index

`
  const patched = `import {scanClosestFuturePointMiss} from ${JSON.stringify(scannerPath)}
import {isolatedContext} from "isolated-authority"
` + source.slice(0, begin) + replacement + source.slice(end)
  const build = await Bun.build({ entrypoints: [routePath], target: "bun", plugins: [{ name: "isolated-native-cache-miss-only", setup(builder): void {
    builder.onLoad({ filter: /SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost\.ts$/ }, (): { contents: string; loader: "ts" } => ({ contents: patched, loader: "ts" }))
    builder.onResolve({ filter: /NativeGenericHistoryTaskAuthority$|^isolated-authority$/ }, (): { path: string; namespace: string } => ({ path: "authority", namespace: "isolated-cache-authority" }))
    builder.onLoad({ filter: /.*/, namespace: "isolated-cache-authority" }, (): { contents: string; loader: "js" } => ({ contents: "export const isolatedContext={sqrt:Math.sqrt,apply:Reflect.apply};export function hasNativeGenericIntrinsicContext(value){return value===isolatedContext}", loader: "js" }))
  } }] })
  expect(build.success).toBe(true)
  await Bun.write(join(directory, "route.mjs"), await build.outputs[0]!.text())
  const KernelSolver = (await import(join(directory, "route.mjs"))).SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as typeof NativeSolver
  const opts: ConstructorParameters<typeof NativeSolver>[0] = {
    connectionName: "current", obstacleRoutes: [], minDistBetweenEnteringPoints: 0.05,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 }, A: { x: -2, y: -2, z: 0 }, B: { x: 2, y: 2, z: 0 },
    layerCount: 3, captureSearchDebug: false,
    futureConnections: [{ connectionName: "future", points: [{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0.004, y: 0.005, z: 2 }] }],
  }
  const native = new NativeSolver(structuredClone(opts)), kernel = new KernelSolver(structuredClone(opts))
  const nativeState = native as unknown as ClosestPrivateState, kernelState = kernel as unknown as ClosestPrivateState
  const nativeCoordinates = nativeState.closestFuturePointCacheCoordinates, kernelCoordinates = kernelState.closestFuturePointCacheCoordinates
  const nativeIndices = nativeState.closestFuturePointCacheIndices, kernelIndices = kernelState.closestFuturePointCacheIndices
  const query: Node = { x: 0, y: 0, z: 0, g: 0, h: 0, f: 0, parent: null }
  let seed = 0x395218a7
  for (let iteration = 0; iteration < 2048; iteration++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5
    if (iteration % 24 === 0) {
      for (const solver of [native, kernel]) solver.futureConnectionPoints[0]!.x = (seed >>> 0) / 0x100000000 * 8 - 4
    }
    if (iteration % 24 === 1) {
      for (const solver of [native, kernel]) solver.futureConnectionPoints[0] = { x: 0.2, y: 0.3, z: iteration % 3 }
    }
    if (iteration % 24 === 2) {
      for (const solver of [native, kernel]) solver.futureConnectionPoints = solver.futureConnectionPoints.slice()
    }
    if (iteration % 24 === 3) {
      for (const solver of [native, kernel]) solver.VIA_PENALTY_FACTOR = iteration % 7 - 3
    }
    const actualQuery = iteration % 4 === 0 ? query : { ...query,
      x: ((seed & 1023) - 512) * native.cellStep,
      y: ((seed >>> 10 & 127) - 64) * native.cellStep, z: iteration % 3 }
    const a = native.getClosestFutureConnectionPoint(actualQuery), b = kernel.getClosestFutureConnectionPoint(actualQuery)
    const expectedIndex = a == null ? -1 : native.futureConnectionPoints.indexOf(a)
    expect(b).toBe(expectedIndex < 0 ? null : kernel.futureConnectionPoints[expectedIndex])
    expect(kernelIndices).toEqual(nativeIndices)
    for (let index = 0; index < nativeCoordinates.length; index++) {
      expect(Object.is(kernelCoordinates[index], nativeCoordinates[index])).toBeTrue()
    }
    expect(kernelState.cachedFutureConnectionPointCount).toBe(nativeState.cachedFutureConnectionPointCount)
    expect(kernelState.closestFuturePointCacheCoordinates).toBe(kernelCoordinates)
    expect(kernelState.closestFuturePointCacheIndices).toBe(kernelIndices)
  }
  // The copied class differs only at the miss block; this test supplies no
  // genuine worker authority and makes no production activation/perf claim.
  await rm(directory, { recursive: true, force: true })
})
