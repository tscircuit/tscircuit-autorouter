import { test, expect } from "bun:test"
import { deepStrictEqual } from "node:assert"
import { MultiSimplifiedPathSolver } from "@tscircuit/trace-simplification-solver"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { captureParallelPathPrototypeContract, createParallelPathLookaheadEligibility,
  type ParallelPathLookaheadEligibility } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/createParallelPathLookaheadEligibility"
import { initializeReferenceDrcRuntime } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"
import type { HighDensityRoute } from "../../lib/types/high-density-types"

class ExactOwner extends MultiSimplifiedPathSolver {}
const ownerContract = captureParallelPathPrototypeContract(ExactOwner.prototype)

function route(name: string, x: number): HighDensityRoute {
  return { connectionName: name, traceThickness: 0.15, viaDiameter: 0.3,
    route: [{ x, y: 0, z: 0 }, { x: x + 0.4, y: 0.1, z: 0 }, { x: x + 1, y: 0, z: 0 }], vias: [] }
}

function makeOwner(): ExactOwner {
  return new ExactOwner({ unsimplifiedHdRoutes: [route("a", 0), route("near", 0.1), route("far", 100), route("later", 200)],
    otherHdRoutes: [route("fixed", 400)], connMap: new ConnectivityMap({ net: ["a", "alias"] }),
    obstacles: [{ type: "rect", center: { x: 0.5, y: 0.3 }, width: 0.1, height: 0.1, layers: ["top"], connectedTo: [] },
      { type: "rect", center: { x: 700, y: 0 }, width: 1, height: 1, layers: ["top"], connectedTo: [] }],
    outline: [{ x: -10, y: -10 }, { x: 1000, y: -10 }, { x: 1000, y: 10 }, { x: -10, y: 10 }] })
}

function guardFor(owner: ExactOwner): ParallelPathLookaheadEligibility {
  const guard = createParallelPathLookaheadEligibility(owner, ownerContract)
  expect(guard).toBeDefined()
  if (!guard) throw new Error("Expected native plain-data phase admission")
  expect(guard()).toBe(true)
  return guard
}

test("native pending scopes retain clone-time selected inputs, stale index selection and independent full control alias checks", async (): Promise<void> => {
  await initializeReferenceDrcRuntime()
  const owner = makeOwner(), guard = guardFor(owner)
  const scope = guard.captureScope([0])
  expect(scope?.()).toBe(true)
  expect(guard.captureScope([])).toBeUndefined()
  expect(guard.captureScope([1, 0])).toBeUndefined()
  expect(guard.captureScope([0, 0])).toBeUndefined()
  expect(guard.captureScope([5])).toBeUndefined()
  expect(guard.captureAwaitState((): boolean => true)).toBeUndefined()
  const otherGuard = guardFor(makeOwner())
  expect(guard.captureAwaitState(otherGuard.captureScope([0]))).toBeUndefined()

  const far = owner.unsimplifiedHdRoutes[2]!.route[0]!, originalFarX = far.x
  far.x = 0.3
  // Native index still uses its constructor-era bounds for the unselected row.
  expect(scope?.()).toBe(true)
  expect(guard()).toBe(false)
  expect(guard.captureScope([2])).toBeUndefined()
  far.x = originalFarX
  expect(guard()).toBe(true)

  const peer = owner.unsimplifiedHdRoutes[1]!.route[0]!, originalPeerX = peer.x
  peer.x = 500
  expect(scope?.()).toBe(false)
  expect(guard.captureScope([0])).toBeUndefined()
  peer.x = originalPeerX
  expect(scope?.()).toBe(true)

  let getterReads = 0
  const descriptor = Object.getOwnPropertyDescriptor(peer, "x")!
  Object.defineProperty(peer, "x", { configurable: true, enumerable: true,
    get: (): number => { getterReads++; throw new RangeError("selected peer observer") } })
  expect(scope?.()).toBe(false)
  expect(guard.captureScope([0])).toBeUndefined()
  expect(getterReads).toBe(0)
  Object.defineProperty(peer, "x", descriptor)

  const later = owner.unsimplifiedHdRoutes[3]!.route[0]!, laterDescriptor = Object.getOwnPropertyDescriptor(later, "x")!
  Object.defineProperty(later, "x", { configurable: true, enumerable: true,
    get: (): number => { getterReads++; throw new RangeError("future route observer") } })
  expect(scope?.()).toBe(true)
  expect(guard()).toBe(false)
  expect(guard.captureScope([3])).toBeUndefined()
  expect(getterReads).toBe(0)
  Object.defineProperty(later, "x", laterDescriptor)

  const selectedObstacle = owner.obstacles[0]!.center, oldY = selectedObstacle.y
  selectedObstacle.y += 10
  expect(scope?.()).toBe(false)
  selectedObstacle.y = oldY
  owner.obstacles[1]!.center.y += 10
  expect(scope?.()).toBe(true)
  owner.obstacles[1]!.center.y -= 10
  owner.connMap.idToNetMap.alias = "changed"
  expect(scope?.()).toBe(false)
  owner.connMap.idToNetMap.alias = "net"
  owner.outline![0]!.x++
  expect(scope?.()).toBe(false)
  owner.outline![0]!.x--

  const controls = makeOwner(), controlGuard = guardFor(controls), controlScope = controlGuard.captureScope([0])!
  const sourceAlias = controls.unsimplifiedHdRoutes[3]!.route[0]!
  controls.simplifiedHdRoutes.push({ ...route("published", 700), route: [sourceAlias] })
  const controlCheck = controlGuard.captureAwaitState(controlScope)
  expect(controlCheck?.()).toBe(true)
  sourceAlias.y++
  expect(controlScope()).toBe(true)
  expect(controlCheck?.()).toBe(false)
  expect(controlGuard.captureAwaitState(controlScope)).toBeUndefined()
  sourceAlias.y--
  expect(controlCheck?.()).toBe(true)
  controls.iterations++
  expect(controlCheck?.()).toBe(false)
  controls.iterations--

  const index = (controls as unknown as { geometryIndex: { getCandidateRoutes: unknown; obstacleIndex: { _boxes: Float64Array } } }).geometryIndex
  const boxes = index.obstacleIndex._boxes, firstBox = boxes[0]!
  boxes[0] = firstBox + 0.25
  expect(controlScope()).toBe(false)
  expect(controlCheck?.()).toBe(false)
  boxes[0] = firstBox
  expect(controlCheck?.()).toBe(true)
  Object.defineProperty(index, "getCandidateRoutes", { configurable: true, value: Number })
  expect(controlGuard.captureScope([0])).toBeUndefined()
  delete (index as unknown as Record<string, unknown>).getCandidateRoutes
  const cloneDescriptor = Object.getOwnPropertyDescriptor(globalThis, "structuredClone")!
  Object.defineProperty(globalThis, "structuredClone", { configurable: true,
    get: (): never => { getterReads++; throw new RangeError("clone observer") } })
  try {
    expect(controlScope()).toBe(false)
    expect(controlGuard.captureScope([0])).toBeUndefined()
    expect(getterReads).toBe(0)
  } finally { Object.defineProperty(globalThis, "structuredClone", cloneDescriptor) }

  for (const property of ["jumpers", "connectionName"]) {
    const unsupported = makeOwner(), target = unsupported.unsimplifiedHdRoutes[0]!
    Object.defineProperty(target, property, { configurable: true, enumerable: false, value: property === "jumpers" ? [] : "a" })
    expect(createParallelPathLookaheadEligibility(unsupported, ownerContract)).toBeUndefined()
  }
  const unsupportedSymbol = makeOwner()
  Object.defineProperty(unsupportedSymbol.unsimplifiedHdRoutes[0], Symbol("hidden"), { value: 1, enumerable: true })
  expect(createParallelPathLookaheadEligibility(unsupportedSymbol, ownerContract)).toBeUndefined()

  // Full default Native behavior remains the public continuation. Exact source
  // aliases and logical caps do not depend on whether a scope was inspected.
  const native = makeOwner(), inspected = makeOwner(), inspectedGuard = guardFor(inspected)
  const nativeInput = structuredClone(native.unsimplifiedHdRoutes)
  while (!native.solved && !native.failed) native.step()
  while (!inspected.solved && !inspected.failed) {
    if (!inspected.activeSubSolver && inspected.currentUnsimplifiedHdRouteIndex < inspected.unsimplifiedHdRoutes.length) {
      expect(inspectedGuard.captureScope([inspected.currentUnsimplifiedHdRouteIndex])?.()).toBe(true)
    }
    inspected.step()
  }
  deepStrictEqual(inspected.simplifiedHdRoutes, native.simplifiedHdRoutes)
  deepStrictEqual(inspected.unsimplifiedHdRoutes, nativeInput)
  expect(inspected.iterations).toBe(native.iterations)
  expect(inspected.MAX_ITERATIONS).toBe(native.MAX_ITERATIONS)
  expect(inspected.solved).toBe(native.solved)
  expect(inspected.failed).toBe(native.failed)
  expect(inspectedGuard.stats.scopeObjects).toBeGreaterThan(0)
  expect(inspectedGuard.stats.scopeIndexSourceEdgesSkipped).toBeGreaterThan(0)
  expect(controlGuard.stats.scopeControlOriginalObjects).toBeGreaterThan(0)
})
