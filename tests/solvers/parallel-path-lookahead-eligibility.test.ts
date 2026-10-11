import { expect, test } from "bun:test"
import { MultiSimplifiedPathSolver, SingleSimplifiedPathSolver5 } from "@tscircuit/trace-simplification-solver"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { strictEqual } from "node:assert"
import {
  captureParallelPathPrototypeContract,
  createParallelPathLookaheadEligibility,
  type ParallelPathLookaheadEligibility,
} from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/createParallelPathLookaheadEligibility"
import {
  getReferenceDrcProxyInspector,
  initializeReferenceDrcRuntime,
} from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"
import type { HighDensityRoute } from "../../lib/types/high-density-types"

class ExactOwner extends MultiSimplifiedPathSolver {}
const ownerContract = captureParallelPathPrototypeContract(ExactOwner.prototype)
type Params = ConstructorParameters<typeof MultiSimplifiedPathSolver>[0]

function makeRoute(name: string, y: number, z = 0): HighDensityRoute {
  return { connectionName: name, traceThickness: 0.15, viaDiameter: 0.3,
    route: [{ x: -1, y, z }, { x: 0.2, y: y + 0.5, z }, { x: 1, y, z }],
    vias: [{ x: 0.2, y: y + 0.5 }] }
}

function makeOwner(overrides: Partial<Params> = {}): ExactOwner {
  return new ExactOwner({
    unsimplifiedHdRoutes: [makeRoute("a", 0), makeRoute("b", 1, 1)],
    otherHdRoutes: [makeRoute("fixed", -1, 1)],
    obstacles: [{ type: "rect", center: { x: 0.4, y: 1.8 }, width: 0.3, height: 0.2,
      layers: ["top"], connectedTo: [] }],
    outline: [{ x: -3, y: -3 }, { x: 3, y: -3 }, { x: 3, y: 3 }, { x: -3, y: 3 }],
    colorMap: { a: "blue" },
    connMap: new ConnectivityMap({ "same-net": ["a", "alias"] }),
    ...overrides,
  })
}

function getGuard(owner: ExactOwner): ParallelPathLookaheadEligibility {
  const guard = createParallelPathLookaheadEligibility(owner, ownerContract)
  expect(guard).toBeDefined()
  if (!guard) throw new Error("Ordinary native path owner was not admitted")
  expect(guard()).toBe(true)
  return guard
}

test("lookahead admission snapshots exact native geometry and rejects changed live hooks without observing them", async (): Promise<void> => {
  if (getReferenceDrcProxyInspector() === undefined) {
    expect(createParallelPathLookaheadEligibility(makeOwner(), ownerContract)).toBeUndefined()
  }
  await initializeReferenceDrcRuntime()
  const nativeOwner = new MultiSimplifiedPathSolver({ unsimplifiedHdRoutes: [makeRoute("native", 0)], obstacles: [] })
  const nativeGuard = createParallelPathLookaheadEligibility(nativeOwner,
    captureParallelPathPrototypeContract(MultiSimplifiedPathSolver.prototype))
  expect(nativeGuard?.()).toBe(true)
  const ordinary = makeOwner()
  const guard = getGuard(ordinary)
  ordinary.iterations++
  ordinary.currentUnsimplifiedHdRouteIndex++
  ordinary.simplifiedHdRoutes.push(ordinary.unsimplifiedHdRoutes[0]!)
  expect(guard()).toBe(true)

  type Mutation = (owner: ExactOwner) => () => void
  const mutations: Mutation[] = [
    (owner): (() => void) => { const point = owner.unsimplifiedHdRoutes[0]!.route[0]!; const value = point.x; point.x += 0.25; return (): void => { point.x = value } },
    (owner): (() => void) => { const point = owner.unsimplifiedHdRoutes[0]!.route[0]!; const value = point.y; point.y = -0; return (): void => { point.y = value } },
    (owner): (() => void) => { const route = owner.unsimplifiedHdRoutes[0]!; const value = route.traceThickness; route.traceThickness *= 2; return (): void => { route.traceThickness = value } },
    (owner): (() => void) => { const route = owner.unsimplifiedHdRoutes[0]!; const value = route.connectionName; route.connectionName = "changed"; return (): void => { route.connectionName = value } },
    (owner): (() => void) => { const via = owner.unsimplifiedHdRoutes[0]!.vias[0]!; const value = via.x; via.x += 0.25; return (): void => { via.x = value } },
    (owner): (() => void) => { const routes = owner.unsimplifiedHdRoutes; routes.push(makeRoute("later", 2)); return (): void => { routes.pop() } },
    (owner): (() => void) => { const point = owner.otherHdRoutes[0]!.route[0]!; const value = point.x; point.x += 0.25; return (): void => { point.x = value } },
    (owner): (() => void) => { const obstacle = owner.obstacles[0]!; const value = obstacle.center.x; obstacle.center.x += 0.25; return (): void => { obstacle.center.x = value } },
    (owner): (() => void) => { const layers = owner.obstacles[0]!.layers; const value = layers[0]!; layers[0] = "bottom"; return (): void => { layers[0] = value } },
    (owner): (() => void) => { const point = owner.outline![0]!; const value = point.y; point.y += 0.25; return (): void => { point.y = value } },
    (owner): (() => void) => { const value = owner.colorMap.a!; owner.colorMap.a = "red"; return (): void => { owner.colorMap.a = value } },
    (owner): (() => void) => { const map = owner.connMap.idToNetMap; const value = map.a!; map.a = "other-net"; return (): void => { map.a = value } },
    (owner): (() => void) => { const ids = owner.connMap.netMap["same-net"]!; ids.push("new-id"); return (): void => { ids.pop() } },
    (owner): (() => void) => { const value = owner.MAX_ITERATIONS; owner.MAX_ITERATIONS--; return (): void => { owner.MAX_ITERATIONS = value } },
    (owner): (() => void) => { const value = owner.connMap; owner.connMap = new ConnectivityMap({}); return (): void => { owner.connMap = value } },
    (owner): (() => void) => { const value = owner.unsimplifiedHdRoutes; owner.unsimplifiedHdRoutes = value.slice(); return (): void => { owner.unsimplifiedHdRoutes = value } },
  ]
  for (const mutate of mutations) {
    const owner = makeOwner()
    const currentGuard = getGuard(owner)
    const restore = mutate(owner)
    expect(currentGuard()).toBe(false)
    restore()
    expect(currentGuard()).toBe(true)
  }
  for (const key of ["defaultViaDiameter", "minBoardEdgeClearance"] as const) {
    const owner = makeOwner({ [key]: 0 })
    const currentGuard = getGuard(owner)
    owner[key] = -0
    expect(currentGuard()).toBe(false)
    owner[key] = 0
    expect(currentGuard()).toBe(true)
  }

  for (const hook of ["step", "_step", "solve", "getSolverName", "tryFinalAcceptance", "computeProgress"]) {
    const owner = makeOwner()
    const currentGuard = getGuard(owner)
    let calls = 0
    Object.defineProperty(owner, hook, { configurable: true, value: (): never => { calls++; throw new Error("must not call custom hook") } })
    expect(currentGuard()).toBe(false)
    expect(createParallelPathLookaheadEligibility(owner, ownerContract)).toBeUndefined()
    expect(calls).toBe(0)
    Reflect.deleteProperty(owner, hook)
    expect(currentGuard()).toBe(true)
  }

  let observations = 0
  const trap = (): never => { observations++; throw new Error("eligibility must not observe caller geometry") }
  const getterOwner = makeOwner()
  Object.defineProperty(getterOwner.unsimplifiedHdRoutes[0]!.route[0]!, "x", { configurable: true, get: trap })
  expect(createParallelPathLookaheadEligibility(getterOwner, ownerContract)).toBeUndefined()
  const rootGetter = makeOwner()
  Object.defineProperty(rootGetter, "obstacles", { configurable: true, get: trap })
  expect(createParallelPathLookaheadEligibility(rootGetter, ownerContract)).toBeUndefined()
  const mapGetter = makeOwner()
  Object.defineProperty(mapGetter.connMap, "areIdsConnected", { configurable: true, get: trap })
  expect(createParallelPathLookaheadEligibility(mapGetter, ownerContract)).toBeUndefined()
  const observerMap = makeOwner()
  Object.defineProperty(observerMap.connMap, "areIdsConnected", { configurable: true, value: trap })
  expect(createParallelPathLookaheadEligibility(observerMap, ownerContract)).toBeUndefined()
  const observableProxy = <T extends object>(value: T): T =>
    new Proxy(value, { get: trap, ownKeys: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap })
  const proxyOwner = makeOwner()
  expect(createParallelPathLookaheadEligibility(observableProxy(proxyOwner), ownerContract)).toBeUndefined()
  const proxyRouteOwner = makeOwner()
  proxyRouteOwner.unsimplifiedHdRoutes[0]!.route[0] = observableProxy(proxyRouteOwner.unsimplifiedHdRoutes[0]!.route[0]!)
  expect(createParallelPathLookaheadEligibility(proxyRouteOwner, ownerContract)).toBeUndefined()
  const proxyRootOwner = makeOwner()
  proxyRootOwner.unsimplifiedHdRoutes = observableProxy(proxyRootOwner.unsimplifiedHdRoutes)
  expect(createParallelPathLookaheadEligibility(proxyRootOwner, ownerContract)).toBeUndefined()
  const proxyMapOwner = makeOwner()
  proxyMapOwner.connMap = observableProxy(proxyMapOwner.connMap)
  expect(createParallelPathLookaheadEligibility(proxyMapOwner, ownerContract)).toBeUndefined()
  expect(observations).toBe(0)

  const unchanged = makeOwner()
  const currentGuard = getGuard(unchanged)
  const sqrtDescriptor = Object.getOwnPropertyDescriptor(Math, "sqrt")!
  Object.defineProperty(Math, "sqrt", { configurable: true, get: trap })
  try {
    strictEqual(currentGuard(), false)
    strictEqual(createParallelPathLookaheadEligibility(unchanged, ownerContract), undefined)
    strictEqual(observations, 0)
  } finally { Object.defineProperty(Math, "sqrt", sqrtDescriptor) }
  expect(currentGuard()).toBe(true)
  const iteratorPrototype = Object.getPrototypeOf([][Symbol.iterator]()) as object
  const nextDescriptor = Object.getOwnPropertyDescriptor(iteratorPrototype, "next")!
  Object.defineProperty(iteratorPrototype, "next", { ...nextDescriptor, value: trap })
  try {
    strictEqual(currentGuard(), false)
    strictEqual(createParallelPathLookaheadEligibility(unchanged, ownerContract), undefined)
    strictEqual(observations, 0)
  } finally { Object.defineProperty(iteratorPrototype, "next", nextDescriptor) }
  expect(currentGuard()).toBe(true)
  const nativeQueryDescriptor = Object.getOwnPropertyDescriptor(SingleSimplifiedPathSolver5.prototype, "isValidPathSegment")!
  expect(nativeQueryDescriptor).toBeDefined()
  Object.defineProperty(SingleSimplifiedPathSolver5.prototype, "isValidPathSegment", { ...nativeQueryDescriptor, value: trap })
  try {
    expect(currentGuard()).toBe(false)
    expect(createParallelPathLookaheadEligibility(unchanged, ownerContract)).toBeUndefined()
    expect(observations).toBe(0)
  } finally { Object.defineProperty(SingleSimplifiedPathSolver5.prototype, "isValidPathSegment", nativeQueryDescriptor) }
  expect(currentGuard()).toBe(true)

  const alteredPrototypeOwner = makeOwner()
  Object.setPrototypeOf(alteredPrototypeOwner, Object.create(ExactOwner.prototype))
  expect(createParallelPathLookaheadEligibility(alteredPrototypeOwner, ownerContract)).toBeUndefined()
  for (const policy of [{ enableVertexShortcuts: true }, { useTraceWidthAwareClearance: true }]) {
    expect(createParallelPathLookaheadEligibility(makeOwner(policy), ownerContract)).toBeUndefined()
  }
  const signedZeroOwner = makeOwner()
  signedZeroOwner.unsimplifiedHdRoutes[0]!.route[0]!.x = -0
  expect(createParallelPathLookaheadEligibility(signedZeroOwner, ownerContract)).toBeUndefined()
  const unsupportedOwner = makeOwner()
  unsupportedOwner.unsimplifiedHdRoutes[0]!.route[0]!.z = 32
  expect(createParallelPathLookaheadEligibility(unsupportedOwner, ownerContract)).toBeUndefined()
})
