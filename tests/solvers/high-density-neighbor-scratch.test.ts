import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { frozenHighDensityGetNeighbors } from "tests/fixtures/frozenHighDensityGetNeighbors"

const apply = Reflect.apply
const nativeKey = SingleHighDensityRouteSolver.prototype.getNodeKey

type Solver = SingleHighDensityRouteSolver
type Params = ConstructorParameters<typeof SingleHighDensityRouteSolver>[0]
type SolverClass = new (params: Params) => Solver

class FrozenSolver extends SingleHighDensityRouteSolver {
  override getNeighbors(node: Node): Node[] {
    return apply(frozenHighDensityGetNeighbors, this, [node])
  }
}

class FrozenFutureSolver extends SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost {
  override getNeighbors(node: Node): Node[] {
    return apply(frozenHighDensityGetNeighbors, this, [node])
  }
}

function makeParams(layerCount: number = 3): Params {
  const obstacleRoutes: HighDensityIntraNodeRoute[] = []
  for (let index = 0; index < 12; index++) {
    const x = (index % 4) - 1.5
    const y = Math.floor(index / 4) - 1
    obstacleRoutes.push({
      connectionName: `obstacle-${index}`,
      traceThickness: 0.05,
      viaDiameter: 0.2,
      route: [
        { x, y, z: index % layerCount },
        { x: x + 0.15, y: y + 0.21, z: index % layerCount },
      ],
      vias: index % 4 === 0 ? [{ x, y }] : [],
    })
  }
  return {
    connectionName: "current",
    obstacleRoutes,
    minDistBetweenEnteringPoints: 0.05,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    A: { x: -2, y: -1.8, z: 0 },
    B: { x: 2, y: 1.8, z: layerCount - 1 },
    traceThickness: 0.05,
    viaDiameter: 0.2,
    obstacleMargin: 0.05,
    layerCount,
    availableZ: Array.from({ length: layerCount }, (_, z) => z),
    captureSearchDebug: false,
    futureConnections: [
      {
        connectionName: "future",
        points: [
          { x: -1, y: 1, z: 1 },
          { x: 1, y: -1, z: 1 },
        ],
      },
    ],
  }
}

function makeNode(x: number, y: number, z: number): Node {
  return {
    x,
    y,
    z,
    g: 2,
    h: 3,
    f: 5,
    parent: { x, y, z: 0, g: 1, h: 2, f: 3, parent: null },
  }
}

function summarize(solver: Solver, neighbors: Node[]): unknown {
  return {
    neighbors,
    explored: [...solver.exploredNodes],
    blocked: [...solver.debug_nodesTooCloseToObstacle],
    intersected: [...solver.debug_nodePathToParentIntersectsObstacle],
  }
}

function retainHooks(SolverType: SolverClass): unknown {
  const solver = new SolverType(makeParams(1))
  const parent = makeNode(0, 0, 0)
  const retained: Node[] = []
  const observations: number[][] = []
  solver.isNodeTooCloseToObstacle = function (node: Node): boolean {
    retained.push(node)
    observations.push([node.x, node.y, node.z, node.g, node.h, node.f])
    return retained.length % 3 === 0
  }
  solver.isNodeTooCloseToEdge = function (node: Node): boolean {
    return node.y < 0
  }
  solver.doesPathToParentIntersectObstacle = function (node: Node): boolean {
    return node.x < 0
  }
  const neighbors = solver.getNeighbors(parent)
  return {
    result: summarize(solver, neighbors),
    observations,
    retainedValues: retained.map((node) => [
      node.x,
      node.y,
      node.z,
      node.g,
      node.h,
      node.f,
    ]),
    unique: new Set(retained).size,
  }
}

function keyGetterChanges(SolverType: SolverClass): unknown {
  const solver = new SolverType(makeParams(1))
  const events: string[] = []
  const retained: Node[] = []
  const node = makeNode(0, 0, 0)
  let getterCalls = 0
  let parentG = 2
  let currentKey = nativeKey
  const customKey = function (this: Solver, neighbor: Node): number {
    events.push(
      `key:${this === solver}:${neighbor.x}:${neighbor.y}:${neighbor.g}`,
    )
    retained.push(neighbor)
    return apply(nativeKey, this, [neighbor])
  }
  Object.defineProperty(customKey, "call", {
    get(): never {
      throw new Error("getNodeKey.call must not be read")
    },
  })
  Object.defineProperty(node, "g", {
    get(): number {
      events.push(`g:${parentG}`)
      currentKey = ++getterCalls % 2 === 0 ? customKey : nativeKey
      return parentG
    },
  })
  Object.defineProperty(solver, "getNodeKey", {
    get(): typeof nativeKey {
      events.push("get-key")
      parentG += 1
      return currentKey
    },
  })
  solver.exploredNodes.has = function (key: number): boolean {
    events.push(`has:${key}`)
    return true
  }
  const neighbors = solver.getNeighbors(node)
  return {
    events,
    neighbors,
    values: retained.map((candidate) => [
      candidate.x,
      candidate.y,
      candidate.g,
    ]),
    unique: new Set(retained).size,
  }
}

function customSetReentry(SolverType: SolverClass): unknown {
  const solver = new SolverType(makeParams(1))
  const retained: Node[] = []
  const events: string[] = []
  let calls = 0
  const customKey = function (this: Solver, node: Node): number {
    retained.push(node)
    events.push(`custom:${node.x}:${node.y}`)
    return apply(nativeKey, this, [node])
  }
  solver.exploredNodes.has = function (key: number): boolean {
    events.push(`has:${key}`)
    calls += 1
    if (calls === 2) {
      const nested = new SolverType(makeParams(1))
      nested.exploredNodes.has = (): boolean => true
      events.push(`nested:${nested.getNeighbors(makeNode(0, 0, 0)).length}`)
      solver.getNodeKey = customKey
    }
    return true
  }
  solver.getNeighbors(makeNode(0, 0, 0))
  return {
    events,
    unique: new Set(retained).size,
    retained: retained.map((node) => [node.x, node.y, node.g]),
  }
}

test("neighbor scratch preserves frozen outputs, dispatch, and exposed node identities", (): void => {
  for (const [Trial, Original] of [
    [SingleHighDensityRouteSolver, FrozenSolver],
    [
      SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost,
      FrozenFutureSolver,
    ],
  ] as const) {
    for (const layerCount of [1, 2, 4]) {
      for (const cellStep of [0.05, 0.2, 1]) {
        for (const [x, y, z] of [
          [0, 0, 0],
          [-2, -2, 0],
          [2, 2, layerCount - 1],
          [-0, 0, 0],
          [0.10000000000000002, -0.2, 0],
        ]) {
          for (const mask of [0, 1, 85, 170, 255]) {
            const trial = new Trial(makeParams(layerCount))
            const original = new Original(makeParams(layerCount))
            trial.cellStep = original.cellStep = cellStep
            trial.debugEnabled = original.debugEnabled = mask % 2 === 0
            const node = makeNode(x, y, z)
            let bit = 0
            for (let dx = -1; dx <= 1; dx++) {
              for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue
                if (mask & (1 << bit)) {
                  const candidate = {
                    ...node,
                    x: Math.max(-2, Math.min(2, x + dx * cellStep)),
                    y: Math.max(-2, Math.min(2, y + dy * cellStep)),
                  }
                  const key = apply(nativeKey, trial, [candidate])
                  trial.exploredNodes.add(key)
                  original.exploredNodes.add(key)
                }
                bit += 1
              }
            }
            expect(summarize(trial, trial.getNeighbors(node))).toEqual(
              summarize(original, original.getNeighbors(node)),
            )
          }
        }
      }
    }
  }

  expect(retainHooks(SingleHighDensityRouteSolver)).toEqual(
    retainHooks(FrozenSolver),
  )
  expect(keyGetterChanges(SingleHighDensityRouteSolver)).toEqual(
    keyGetterChanges(FrozenSolver),
  )
  expect(customSetReentry(SingleHighDensityRouteSolver)).toEqual(
    customSetReentry(FrozenSolver),
  )

  const callDescriptor = Object.getOwnPropertyDescriptor(
    Function.prototype,
    "call",
  )!
  let calls = 0
  const trial = new SingleHighDensityRouteSolver(makeParams(1))
  const original = new FrozenSolver(makeParams(1))
  trial.exploredNodes.has = original.exploredNodes.has = (): boolean => true
  let trialResult: unknown
  let originalResult: unknown
  try {
    Object.defineProperty(Function.prototype, "call", {
      ...callDescriptor,
      value(): never {
        calls += 1
        throw new Error("Function.prototype.call must not be used")
      },
    })
    trialResult = trial.getNeighbors(makeNode(0, 0, 0))
    originalResult = original.getNeighbors(makeNode(0, 0, 0))
  } finally {
    Object.defineProperty(Function.prototype, "call", callDescriptor)
  }
  expect(trialResult).toEqual(originalResult)
  expect(calls).toBe(0)

  const keyCallDescriptor = Object.getOwnPropertyDescriptor(nativeKey, "call")
  const applyDescriptor = Object.getOwnPropertyDescriptor(Reflect, "apply")!
  let extraCalls = 0
  try {
    Object.defineProperty(nativeKey, "call", {
      configurable: true,
      get(): never {
        extraCalls += 1
        throw new Error("native key call property must not be read")
      },
    })
    Object.defineProperty(Reflect, "apply", {
      ...applyDescriptor,
      value(): never {
        extraCalls += 1
        throw new Error("runtime Reflect.apply must not be read")
      },
    })
    trialResult = trial.getNeighbors(makeNode(0, 0, 0))
    originalResult = original.getNeighbors(makeNode(0, 0, 0))
  } finally {
    Object.defineProperty(Reflect, "apply", applyDescriptor)
    if (keyCallDescriptor) {
      Object.defineProperty(nativeKey, "call", keyCallDescriptor)
    } else {
      delete (nativeKey as unknown as { call?: unknown }).call
    }
  }
  expect(trialResult).toEqual(originalResult)
  expect(extraCalls).toBe(0)

  for (const [Trial, Original] of [
    [SingleHighDensityRouteSolver, FrozenSolver],
    [
      SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost,
      FrozenFutureSolver,
    ],
  ] as const) {
    const trial = new Trial(makeParams(3))
    const original = new Original(makeParams(3))
    for (let iteration = 0; iteration < 250; iteration++) {
      if (trial.solved || trial.failed) break
      trial.step()
      original.step()
      expect(trial.candidates.getTopN(Number.MAX_SAFE_INTEGER)).toEqual(
        original.candidates.getTopN(Number.MAX_SAFE_INTEGER),
      )
      expect([...trial.exploredNodes]).toEqual([...original.exploredNodes])
      expect<Array<boolean | string | number | null>>([
        trial.solved,
        trial.failed,
        trial.error,
        trial.iterations,
      ]).toEqual([
        original.solved,
        original.failed,
        original.error,
        original.iterations,
      ])
    }
    expect(trial.solvedPath).toEqual(original.solvedPath)
    expect(trial.MAX_ITERATIONS).toBe(original.MAX_ITERATIONS)
  }
})
