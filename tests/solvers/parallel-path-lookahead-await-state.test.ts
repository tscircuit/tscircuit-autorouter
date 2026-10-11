import { test } from "bun:test"
import { ok, strictEqual } from "node:assert"
import { MultiSimplifiedPathSolver } from "@tscircuit/trace-simplification-solver"
import {
  captureParallelPathPrototypeContract,
  createParallelPathLookaheadEligibility,
  type ParallelPathLookaheadEligibility,
} from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/createParallelPathLookaheadEligibility"
import { initializeReferenceDrcRuntime } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"

class Owner extends MultiSimplifiedPathSolver { adapterOpaque: object = { pending: [] } }
const contract = captureParallelPathPrototypeContract(Owner.prototype)
type ReflectedState = Record<string, unknown>

function makeOwner(): Owner {
  return new Owner({ unsimplifiedHdRoutes: [{ connectionName: "a", traceThickness: 0.15, viaDiameter: 0.3,
    route: [{ x: 1, y: 1, z: 0 }, { x: 1.5, y: 1.4, z: 0 }, { x: 2, y: 2, z: 0 }], vias: [] }],
    obstacles: [{ type: "rect", center: { x: 3, y: 3 }, width: 1, height: 1, layers: ["top"], connectedTo: [] }] })
}

function snapshot(owner: Owner): { guard: ParallelPathLookaheadEligibility; check: () => boolean } {
  const guard = createParallelPathLookaheadEligibility(owner, contract)!
  strictEqual(guard(), true)
  const check = guard.captureAwaitState()!
  strictEqual(typeof check, "function")
  strictEqual(check(), true)
  return { guard, check }
}

test("await snapshots preserve actual native control, child state, index bytes and collection contents without observing late hooks", async (): Promise<void> => {
  await initializeReferenceDrcRuntime()
  const owner = makeOwner()
  const firstGuard = createParallelPathLookaheadEligibility(owner, contract)!
  const beforeCapture = { ...firstGuard.stats }
  const firstCheck = firstGuard.captureAwaitState()!
  strictEqual(firstGuard.stats.awaitCaptures, beforeCapture.awaitCaptures + 1)
  ok(firstGuard.stats.awaitSnapshotObjects > beforeCapture.awaitSnapshotObjects)
  ok(firstGuard.stats.awaitSnapshotProperties > beforeCapture.awaitSnapshotProperties)
  ok(firstGuard.stats.awaitBufferBytesCopied > beforeCapture.awaitBufferBytesCopied)
  ok(firstGuard.stats.descriptorBuiltinCalls > beforeCapture.descriptorBuiltinCalls)
  ok(firstGuard.stats.ownKeyReads > beforeCapture.ownKeyReads)
  ok(firstGuard.stats.prototypeReads > beforeCapture.prototypeReads)
  const beforeCheck = { ...firstGuard.stats }
  strictEqual(firstCheck(), true)
  strictEqual(firstGuard.stats.awaitChecks, beforeCheck.awaitChecks + 1)
  ok(firstGuard.stats.awaitBufferBytesCompared > beforeCheck.awaitBufferBytesCompared)
  ok(firstGuard.stats.descriptorBuiltinCalls > beforeCheck.descriptorBuiltinCalls)
  ok(firstGuard.stats.descriptorMetadataFieldReads > beforeCheck.descriptorMetadataFieldReads)
  strictEqual(firstGuard.stats.descriptorMetadataFieldReads, firstGuard.stats.descriptorReads * 4)
  strictEqual(firstGuard.stats.descriptorOwnFieldChecks, firstGuard.stats.descriptorReads * 4)
  const { guard, check } = snapshot(owner)
  const mutations: ((state: ReflectedState) => () => void)[] = [
    (state): (() => void) => { const old = state.iterations; state.iterations = 1; return (): void => { state.iterations = old } },
    (state): (() => void) => { const old = state.currentUnsimplifiedHdRouteIndex; state.currentUnsimplifiedHdRouteIndex = 1; return (): void => { state.currentUnsimplifiedHdRouteIndex = old } },
    (state): (() => void) => { const old = state.solved; state.solved = true; return (): void => { state.solved = old } },
    (state): (() => void) => { const old = state.failed; state.failed = true; return (): void => { state.failed = old } },
    (state): (() => void) => { const old = state.error; state.error = "late error"; return (): void => { state.error = old } },
    (state): (() => void) => { const old = state.progress; state.progress = -0; return (): void => { state.progress = old } },
    (state): (() => void) => { const old = state.activeSubSolver; state.activeSubSolver = {}; return (): void => { state.activeSubSolver = old } },
    (state): (() => void) => { const old = state.simplifiedHdRoutes; state.simplifiedHdRoutes = []; return (): void => { state.simplifiedHdRoutes = old } },
    (state): (() => void) => { const old = state.geometryIndex; state.geometryIndex = {}; return (): void => { state.geometryIndex = old } },
    (state): (() => void) => { const old = state.adapterOpaque; state.adapterOpaque = {}; return (): void => { state.adapterOpaque = old } },
  ]
  for (let index = 0; index < mutations.length; index++) {
    const restore = mutations[index]!(owner as unknown as ReflectedState)
    strictEqual(check(), false)
    restore()
    strictEqual(check(), true)
  }
  const output = owner.unsimplifiedHdRoutes[0]!
  owner.simplifiedHdRoutes.push(output)
  strictEqual(check(), false)
  const outputCheck = guard.captureAwaitState()!
  strictEqual(outputCheck(), true)
  output.route[0]!.x += 0.1
  strictEqual(outputCheck(), false)
  output.route[0]!.x -= 0.1
  // Restoration uses the precise original representation.
  output.route[0]!.x = 1
  strictEqual(outputCheck(), true)
  owner.simplifiedHdRoutes.pop()
  strictEqual(check(), true)
  const indexState = (owner as unknown as { geometryIndex: ReflectedState }).geometryIndex
  const obstacleIndex = indexState.obstacleIndex as { data: ArrayBuffer; _boxes: Float64Array }
  const bytes = new Uint8Array(obstacleIndex.data)
  const original = bytes[8]!
  bytes[8] = original ^ 1
  strictEqual(check(), false)
  bytes[8] = original
  strictEqual(check(), true)
  const mutableRoutes = indexState.mutableRoutes as unknown[]
  const routeEntry = mutableRoutes[0]
  mutableRoutes[0] = undefined
  strictEqual(check(), false)
  mutableRoutes[0] = routeEntry
  strictEqual(check(), true)
  owner.step()
  strictEqual(check(), false)
  const active = owner.activeSubSolver! as unknown as ReflectedState
  const childCheck = guard.captureAwaitState()!
  strictEqual(childCheck(), true)
  const emptyBufferOwner = makeOwner()
  emptyBufferOwner.stats.emptyBuffer = new ArrayBuffer(0)
  const { guard: emptyBufferGuard, check: emptyBufferCheck } = snapshot(emptyBufferOwner)
  ;(emptyBufferOwner.stats.emptyBuffer as ArrayBuffer).transfer()
  strictEqual(emptyBufferCheck(), false)
  strictEqual(emptyBufferGuard.captureAwaitState(), undefined)
  for (const key of ["OBSTACLE_MARGIN", "TRACE_THICKNESS", "MAX_ITERATIONS", "headDistanceAlongPath"] as const) {
    const old = active[key] as number
    active[key] = old + 1
    strictEqual(childCheck(), false)
    active[key] = old
    strictEqual(childCheck(), true)
  }
  const cache = active.cachedValidPathSegments as Set<string>
  cache.add("external")
  strictEqual(childCheck(), false)
  cache.delete("external")
  strictEqual(childCheck(), true)
  const thickness = active.traceThicknessByObstacleSegmentId as Map<string, number>
  thickness.set("external", 0.1)
  strictEqual(childCheck(), false)
  thickness.delete("external")
  strictEqual(childCheck(), true)
  const peers = active.otherHdRoutes as unknown[]
  peers.push(output)
  strictEqual(childCheck(), false)
  peers.pop()
  strictEqual(childCheck(), true)
  let reads = 0
  const observer = (): never => { reads++; throw new RangeError("late native hook") }
  for (const target of [owner, owner.activeSubSolver!]) {
    Object.defineProperty(target, "_step", { configurable: true, get: observer })
    strictEqual(childCheck(), false)
    strictEqual(reads, 0)
    Reflect.deleteProperty(target, "_step")
    strictEqual(childCheck(), true)
  }
  const headDescriptor = Object.getOwnPropertyDescriptor(active, "headDistanceAlongPath")!
  Object.defineProperty(active, "headDistanceAlongPath", { configurable: true, get: observer })
  strictEqual(childCheck(), false)
  strictEqual(guard.captureAwaitState(), undefined)
  strictEqual(reads, 0)
  Object.defineProperty(active, "headDistanceAlongPath", headDescriptor)
  strictEqual(childCheck(), true)
  active.filteredVias = new Proxy(active.filteredVias as object, {
    get: observer, ownKeys: observer, getPrototypeOf: observer, getOwnPropertyDescriptor: observer,
  })
  strictEqual(childCheck(), false)
  strictEqual(guard.captureAwaitState(), undefined)
  strictEqual(reads, 0)
})
