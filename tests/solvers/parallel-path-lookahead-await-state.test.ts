import { test } from "bun:test"
import { deepStrictEqual, ok, strictEqual } from "node:assert"
import { MultiSimplifiedPathSolver } from "@tscircuit/trace-simplification-solver"
import { ParallelMultiSimplifiedPathSolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelMultiSimplifiedPathSolver"
import { Pipeline9LocalWorkerPool } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import {
  captureParallelPathPrototypeContract,
  createParallelPathLookaheadEligibility,
  isNativeParallelPathAwaitStateCheck,
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
  strictEqual(isNativeParallelPathAwaitStateCheck(firstCheck, owner, firstGuard), true)
  strictEqual(isNativeParallelPathAwaitStateCheck((): boolean => true, owner, firstGuard), false)
  strictEqual(isNativeParallelPathAwaitStateCheck(firstCheck, makeOwner(), firstGuard), false)
  strictEqual(isNativeParallelPathAwaitStateCheck(firstCheck, owner, createParallelPathLookaheadEligibility(owner, contract)), false)
  strictEqual(firstGuard.stats.awaitCaptures, beforeCapture.awaitCaptures + 1)
  ok(firstGuard.stats.awaitCoveredObjectsSkipped > beforeCapture.awaitCoveredObjectsSkipped)
  ok(firstGuard.stats.awaitTypedIndexDescriptorsSkipped > beforeCapture.awaitTypedIndexDescriptorsSkipped)
  ok(firstGuard.stats.awaitSnapshotObjects > beforeCapture.awaitSnapshotObjects)
  ok(firstGuard.stats.awaitSnapshotProperties > beforeCapture.awaitSnapshotProperties)
  ok(firstGuard.stats.awaitBufferBytesCopied > beforeCapture.awaitBufferBytesCopied)
  ok(firstGuard.stats.descriptorBuiltinCalls > beforeCapture.descriptorBuiltinCalls)
  ok(firstGuard.stats.ownKeyReads > beforeCapture.ownKeyReads)
  ok(firstGuard.stats.prototypeReads > beforeCapture.prototypeReads)
  const beforeCheck = { ...firstGuard.stats }
  strictEqual(firstCheck(), true)
  strictEqual(firstGuard.stats.awaitChecks, beforeCheck.awaitChecks + 1)
  strictEqual(firstGuard.stats.checks, beforeCheck.checks + 1)
  ok(firstGuard.stats.awaitBufferBytesCompared > beforeCheck.awaitBufferBytesCompared)
  ok(firstGuard.stats.descriptorBuiltinCalls > beforeCheck.descriptorBuiltinCalls)
  ok(firstGuard.stats.descriptorMetadataFieldReads > beforeCheck.descriptorMetadataFieldReads)
  strictEqual(firstGuard.stats.descriptorMetadataFieldReads, firstGuard.stats.descriptorReads * 4)
  strictEqual(firstGuard.stats.descriptorOwnFieldChecks, firstGuard.stats.descriptorReads * 4)
  // Original inputs can be reached through private index aliases or no control
  // root at all: a standalone await checker must run complete input eligibility.
  const input = owner.unsimplifiedHdRoutes[0]!
  const originalPoint = input.route[0]!.x
  input.route[0]!.x = 1.25
  strictEqual(firstCheck(), false)
  input.route[0]!.x = originalPoint
  strictEqual(firstCheck(), true)
  const connState = owner.connMap.idToNetMap
  connState.external = "external"
  strictEqual(firstCheck(), false)
  delete connState.external
  strictEqual(firstCheck(), true)
  const originalOutline = owner.outline
  owner.outline = []
  strictEqual(firstCheck(), false)
  owner.outline = originalOutline
  strictEqual(firstCheck(), true)
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
  // Reused input points and newly created output points have separate proofs.
  const freshOutput = { ...output, route: output.route.map((point) => ({ ...point })), vias: [] }
  owner.simplifiedHdRoutes.push(freshOutput)
  const freshOutputCheck = guard.captureAwaitState()!
  freshOutput.route[0]!.x = 1.25
  strictEqual(freshOutputCheck(), false)
  freshOutput.route[0]!.x = 1
  strictEqual(freshOutputCheck(), true)
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
  const typedOwner = makeOwner()
  // Merely adopting a native prototype does not create integer-index slots.
  const typedPrototypeRecord = Object.create(Float64Array.prototype) as ReflectedState
  typedPrototypeRecord.annotation = "plain descriptor"
  typedOwner.stats.typedPrototypeRecord = typedPrototypeRecord
  const typedBuffer = new ArrayBuffer(32)
  const view = new Float64Array(typedBuffer, 8, 2)
  const viewData = new DataView(typedBuffer)
  viewData.setBigUint64(8, 0x7ff8000000000001n, true)
  view[1] = -0
  const extra = Symbol("view extra")
  Object.defineProperty(view, "annotation", { configurable: true, writable: true, value: { proof: 1 } })
  Object.defineProperty(view, extra, { configurable: true, writable: true, value: "same" })
  typedOwner.stats.typedView = view
  typedOwner.stats.dataView = viewData
  const { guard: typedGuard, check: typedCheck } = snapshot(typedOwner)
  typedPrototypeRecord.annotation = "changed"
  strictEqual(typedCheck(), false)
  typedPrototypeRecord.annotation = "plain descriptor"
  strictEqual(typedCheck(), true)
  ok(typedGuard.stats.awaitTypedIndexDescriptorsSkipped >= view.length * 2)
  viewData.setBigUint64(8, 0x7ff8000000000002n, true)
  strictEqual(typedCheck(), false)
  viewData.setBigUint64(8, 0x7ff8000000000001n, true)
  strictEqual(typedCheck(), true)
  view[1] = 0
  strictEqual(typedCheck(), false)
  view[1] = -0
  strictEqual(typedCheck(), true)
  ;(view as unknown as ReflectedState).annotation = { proof: 1 }
  strictEqual(typedCheck(), false)
  const freshTypedCheck = typedGuard.captureAwaitState()!
  ;((view as unknown as ReflectedState).annotation as ReflectedState).proof = 2
  strictEqual(freshTypedCheck(), false)
  ;((view as unknown as ReflectedState).annotation as ReflectedState).proof = 1
  strictEqual(freshTypedCheck(), true)
  Object.defineProperty(view, extra, { configurable: true, writable: false, value: "same" })
  strictEqual(freshTypedCheck(), false)
  Object.defineProperty(view, extra, { configurable: true, writable: true, value: "same" })
  strictEqual(freshTypedCheck(), true)
  typedOwner.stats.typedView = new Float64Array(typedBuffer, 8, 2)
  strictEqual(freshTypedCheck(), false)
  typedOwner.stats.typedView = view
  strictEqual(freshTypedCheck(), true)
  typedBuffer.transfer()
  strictEqual(freshTypedCheck(), false)
  strictEqual(typedGuard.captureAwaitState(), undefined)
  const pool = new Pipeline9LocalWorkerPool({ workerCount: 4 })
  try {
    for (const prototype of [Map.prototype, Set.prototype, ArrayBuffer.prototype]) {
      const inputOwner = makeOwner()
      const params = { unsimplifiedHdRoutes: [0, 1, 2].map((index) => ({ ...structuredClone(inputOwner.unsimplifiedHdRoutes[0]!),
        connectionName: `forged_receiver_${index}`, route: inputOwner.unsimplifiedHdRoutes[0]!.route.map((point) => ({ ...point, x: point.x + index * 4 })) })),
        obstacles: structuredClone(inputOwner.obstacles) }
      const native = new Owner(structuredClone(params))
      const parallel = new ParallelMultiSimplifiedPathSolver({ ...structuredClone(params),
        workerPool: pool, workerCount: 4, useCertifiedLookahead: true })
      native.stats.forgedReceiver = Object.create(prototype)
      parallel.stats.forgedReceiver = Object.create(prototype)
      const counterfeitGuard = createParallelPathLookaheadEligibility(native, contract)!
      strictEqual(counterfeitGuard(), true)
      strictEqual(counterfeitGuard.captureAwaitState(), undefined)
      ok(counterfeitGuard.stats.awaitReceiverBrandChecks > 0)
      native.solve()
      parallel.step()
      await parallel.pendingEffects![0]!.promise
      strictEqual(parallel.failed, false)
      strictEqual(parallel.solved, true)
      deepStrictEqual(parallel.simplifiedHdRoutes, native.simplifiedHdRoutes)
      strictEqual(parallel.iterations, native.iterations)
      strictEqual(parallel.progress, native.progress)
    }
  } finally { pool.dispose() }
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
