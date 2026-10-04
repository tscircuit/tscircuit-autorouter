import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { expect, test } from "bun:test"
import { MultiHeadPolyLineIntraNodeSolver2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver2_Optimized"
import {
  beginForceWorkspaceStep,
  endForceWorkspaceStep,
  markForceOwned,
  prepareForceWorkspaceCall,
} from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/forceWorkspace"
import type {
  Candidate2,
  MHPoint2,
  PolyLine2,
} from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/types2"
import { MultiHeadPolyLineIntraNodeSolver3 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"
import cn9630 from "fixtures/legacy/assets/cn9630-nodeWithPortPoints.json" with {
  type: "json",
}
import { FrozenD010ForceSolver } from "../fixtures/FrozenD010ForceSolver"

type ForceSolver = MultiHeadPolyLineIntraNodeSolver2 | FrozenD010ForceSolver

function createLines(seed: number): PolyLine2[] {
  const lines: PolyLine2[] = markForceOwned([])
  for (let lineIndex = 0; lineIndex < 4; lineIndex++) {
    const points: MHPoint2[] = markForceOwned([])
    for (let index = 0; index < 7; index++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const x = (seed / 2 ** 32 - 0.5) * 2
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const y = (seed / 2 ** 32 - 0.5) * 2
      points.push(markForceOwned({ x, y, z1: index % 2, z2: (index + lineIndex) % 2 }))
    }
    const mPoints: MHPoint2[] = markForceOwned([])
    for (let index = 1; index < points.length - 1; index++) mPoints.push(points[index]!)
    lines.push(markForceOwned({
      connectionName: `line-${lineIndex}`,
      start: points[0]!,
      end: points[6]!,
      mPoints,
    }))
  }
  return lines
}

function createSolver(
  constructor: typeof MultiHeadPolyLineIntraNodeSolver2 | typeof FrozenD010ForceSolver,
  lines: PolyLine2[],
): ForceSolver {
  const solver = new constructor({
    nodeWithPortPoints: {
      capacityMeshNodeId: "force-workspace",
      center: { x: 0, y: 0 },
      width: 4,
      height: 4,
      portPoints: [],
    },
  })
  solver.phase = "solving"
  solver.checkIfSolved = (): boolean => false
  solver.computeMinGapBtwPolyLines = (): number[] => []
  solver.candidates = [
    markForceOwned({
      polyLines: lines,
      g: 0,
      h: 0,
      f: 0,
      minGaps: [],
      viaCount: 4,
      magForceApplied: 0,
    }),
  ]
  return solver
}

function expectExactNumbers(actual: unknown, expected: unknown): void {
  if (typeof actual === "number" || typeof expected === "number") {
    expect(Object.is(actual, expected)).toBe(true)
    return
  }
  if (
    actual !== null &&
    expected !== null &&
    typeof actual === "object" &&
    typeof expected === "object"
  ) {
    expect(Object.keys(actual)).toEqual(Object.keys(expected))
    for (const key of Object.keys(actual)) {
      expectExactNumbers(
        (actual as Record<string, unknown>)[key],
        (expected as Record<string, unknown>)[key],
      )
    }
    return
  }
  expect(actual).toEqual(expected)
}

function comparePublicSteps(
  lines: PolyLine2[],
  configure: (solver: ForceSolver, calls: string[]) => void,
): void {
  const actual = createSolver(MultiHeadPolyLineIntraNodeSolver2, lines)
  const expected = createSolver(FrozenD010ForceSolver, structuredClone(lines))
  const actualCalls: string[] = []
  const expectedCalls: string[] = []
  configure(actual, actualCalls)
  configure(expected, expectedCalls)
  for (let step = 0; step < 3; step++) {
    actual._step()
    expected._step()
    expect(actualCalls).toEqual(expectedCalls)
    expectExactNumbers(actual.lastCandidate, expected.lastCandidate)
    actualCalls.length = 0
    expectedCalls.length = 0
  }
}


function comparePatchedStep(
  install: (calls: { count: number }) => () => void,
): void {
  const actual = createSolver(MultiHeadPolyLineIntraNodeSolver2, createLines(97))
  const expected = createSolver(FrozenD010ForceSolver, createLines(97))
  const actualCalls = { count: 0 }
  const expectedCalls = { count: 0 }
  let restore = install(actualCalls)
  try {
    actual._step()
  } finally {
    restore()
  }
  restore = install(expectedCalls)
  try {
    expected._step()
  } finally {
    restore()
  }
  expectExactNumbers(actual.lastCandidate, expected.lastCandidate)
  expect(actualCalls.count).toBe(expectedCalls.count)
}

test("step-local force storage retains frozen math and callback behavior", (): void => {
  const frozenSource = readFileSync(
    new URL("../fixtures/FrozenD010ForceSolver.ts", import.meta.url),
    "utf8",
  )
  const restoredSource = frozenSource
    .split("\n")
    .slice(2)
    .join("\n")
    .replace(
      "export class FrozenD010ForceSolver ",
      "export class MultiHeadPolyLineIntraNodeSolver2 ",
    )
    .replace(
      '"lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/types2"',
      '"./types2"',
    )
    .replace(
      '"lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver"',
      '"./MultiHeadPolyLineIntraNodeSolver"',
    )
  expect(createHash("sha256").update(restoredSource).digest("hex")).toBe(
    "640a5234f3ba314d349f2d64406fe43733f8f5f7f58b46991f5c60f004f55264",
  )
  expect(Object.getPrototypeOf(FrozenD010ForceSolver.prototype)).toBe(
    Object.getPrototypeOf(MultiHeadPolyLineIntraNodeSolver2.prototype),
  )

  for (let seed = 1; seed <= 40; seed++) {
    const lines = createLines(seed)
    if (seed % 4 === 0) {
      lines[0]!.mPoints[0] = lines[0]!.start
      lines[1]!.mPoints[1] = lines[0]!.mPoints[2]!
    }
    if (seed % 5 === 0) lines[1]!.mPoints[0]!.x = -0
    comparePublicSteps(lines, (): void => {})
  }

  const actualLines = createLines(51)
  const expectedLines = structuredClone(actualLines)
  const actual = createSolver(MultiHeadPolyLineIntraNodeSolver2, actualLines)
  const expected = createSolver(FrozenD010ForceSolver, expectedLines)
  const candidate = actual.candidates[0]! as Candidate2
  const scope = beginForceWorkspaceStep(
    actual,
    candidate,
    MultiHeadPolyLineIntraNodeSolver2.prototype.applyForcesToPolyLines,
  )
  expect(scope.current).toBeDefined()
  let previousGeometry: NonNullable<typeof scope.current>["geometry"] = null
  let previousForces: NonNullable<typeof scope.current>["netForces"] = null
  try {
    for (let pass = 0; pass < 10; pass++) {
      prepareForceWorkspaceCall(scope)
      expectExactNumbers(
        actual.applyForcesToPolyLines(actualLines),
        expected.applyForcesToPolyLines(expectedLines),
      )
      expectExactNumbers(actualLines, expectedLines)
      if (pass > 0) {
        expect(scope.current!.geometry).toBe(previousGeometry)
        expect(scope.current!.netForces).toBe(previousForces)
      }
      previousGeometry = scope.current!.geometry
      previousForces = scope.current!.netForces
      // Poison private state after a pass to prove every sum and memo is reset.
      for (const forces of scope.current!.netForces!) {
        for (const force of forces) {
          force.fx = NaN
          force.fy = -0
        }
      }
      for (const line of scope.current!.geometry!) {
        for (const segment of line.segments) {
          segment.lastTargetLine = 0
          segment.lastEndpointIndex = 0
          segment.lastFx = Infinity
          segment.lastFy = NaN
          segment.lastForceActive = true
        }
      }
    }
  } finally {
    endForceWorkspaceStep(actual, scope)
  }
  // Public mutation between steps gets a fresh certified geometry/topology.
  actualLines[0]!.mPoints.splice(1, 2)
  expectedLines[0]!.mPoints.splice(1, 2)
  actualLines[1]!.mPoints[0]!.z2 = 7
  expectedLines[1]!.mPoints[0]!.z2 = 7
  actual._step()
  expected._step()
  expectExactNumbers(actual.lastCandidate, expected.lastCandidate)

  comparePublicSteps(createLines(71), (solver, calls): void => {
    const point = solver.candidates[0]!.polyLines[0]!.mPoints[0]!
    let x = point.x
    Object.defineProperty(point, "x", {
      get(): number {
        calls.push("x")
        return x
      },
      set(value: number): void {
        x = value
      },
      enumerable: true,
      configurable: true,
    })
  })
  comparePublicSteps(createLines(72), (solver, calls): void => {
    const native = solver.applyForcesToPolyLines
    Object.defineProperty(solver, "applyForcesToPolyLines", {
      get(): typeof native {
        calls.push("dispatch")
        return function (
          this: ForceSolver,
          lines: PolyLine2[],
        ): ReturnType<typeof native> {
          calls.push(`arguments-${arguments.length}`)
          return native.call(this, lines)
        }
      },
    })
  })
  comparePublicSteps(createLines(73), (solver, calls): void => {
    const bounds = solver.bounds
    Object.defineProperty(solver, "bounds", {
      get(): typeof bounds {
        calls.push("bounds")
        return bounds
      },
    })
  })

  const originalSqrt = Math.sqrt
  const originalFrom = Array.from
  let actualSqrtCalls = 0
  let expectedSqrtCalls = 0
  let actualFromCalls = 0
  let expectedFromCalls = 0
  try {
    const customActual = createSolver(MultiHeadPolyLineIntraNodeSolver2, createLines(81))
    const customExpected = createSolver(FrozenD010ForceSolver, createLines(81))
    Math.sqrt = (value: number): number => {
      actualSqrtCalls++
      return originalSqrt(value)
    }
    Array.from = ((
      ...args: Parameters<typeof Array.from>
    ): ReturnType<typeof Array.from> => {
      actualFromCalls++
      return Reflect.apply(originalFrom, Array, args)
    }) as typeof Array.from
    customActual._step()
    Math.sqrt = (value: number): number => {
      expectedSqrtCalls++
      return originalSqrt(value)
    }
    Array.from = ((
      ...args: Parameters<typeof Array.from>
    ): ReturnType<typeof Array.from> => {
      expectedFromCalls++
      return Reflect.apply(originalFrom, Array, args)
    }) as typeof Array.from
    customExpected._step()
    expectExactNumbers(customActual.lastCandidate, customExpected.lastCandidate)
  } finally {
    Math.sqrt = originalSqrt
    Array.from = originalFrom
  }
  expect(actualSqrtCalls).toBe(expectedSqrtCalls)
  expect(actualFromCalls).toBe(expectedFromCalls)
  expect(actualFromCalls).toBe(50)

  const native = new MultiHeadPolyLineIntraNodeSolver3({
    nodeWithPortPoints: cn9630.nodeWithPortPoints,
    hyperParameters: { SEGMENTS_PER_POLYLINE: 6 },
  })
  const nativeCandidate = native.createInitialCandidateFromSeed(0)!
  expect(nativeCandidate).not.toBeNull()
  const nativeScope = beginForceWorkspaceStep(
    native,
    nativeCandidate,
    MultiHeadPolyLineIntraNodeSolver2.prototype.applyForcesToPolyLines,
  )
  expect(nativeScope.current).toBeDefined()
  endForceWorkspaceStep(native, nativeScope)
  native.phase = "solving"
  native.checkIfSolved = (): boolean => false
  native.computeMinGapBtwPolyLines = (): number[] => []
  nativeCandidate.magForceApplied = 0
  native.candidates = [nativeCandidate]
  const nativeReference = createSolver(
    FrozenD010ForceSolver,
    structuredClone(nativeCandidate.polyLines),
  )
  nativeReference.viaDiameter = native.viaDiameter
  nativeReference.obstacleMargin = native.obstacleMargin
  nativeReference.traceWidth = native.traceWidth
  nativeReference.BOUNDARY_PADDING = native.BOUNDARY_PADDING
  nativeReference.bounds = { ...native.bounds }
  nativeReference.candidates = [structuredClone(nativeCandidate)]
  for (let step = 0; step < 4; step++) {
    native._step()
    nativeReference._step()
    expectExactNumbers(native.lastCandidate, nativeReference.lastCandidate)
  }

  // Unsupported public Proxies decline before any added reflective trap.
  const proxySlots = [
    "receiver", "candidate", "array", "line", "point", "bounds", "prototype",
  ]
  for (const slot of proxySlots) {
    comparePublicSteps(createLines(101), (solver, calls): void => {
      const handler: ProxyHandler<object> = {
        getPrototypeOf(target): object | null {
          calls.push("getPrototypeOf")
          return Reflect.getPrototypeOf(target)
        },
        getOwnPropertyDescriptor(target, key): PropertyDescriptor | undefined {
          calls.push(`descriptor-${String(key)}`)
          return Reflect.getOwnPropertyDescriptor(target, key)
        },
        get(target, key, receiver): unknown {
          calls.push(`get-${String(key)}`)
          return Reflect.get(target, key, receiver)
        },
      }
      const candidate = solver.candidates[0]!
      if (slot === "candidate") {
        solver.candidates[0] = new Proxy(
          candidate,
          handler as ProxyHandler<typeof candidate>,
        )
      }
      if (slot === "array") {
        candidate.polyLines = new Proxy(
          candidate.polyLines,
          handler as ProxyHandler<typeof candidate.polyLines>,
        )
      }
      if (slot === "line") {
        candidate.polyLines[0] = new Proxy(
          candidate.polyLines[0]!,
          handler as ProxyHandler<PolyLine2>,
        )
      }
      if (slot === "point") {
        candidate.polyLines[0]!.mPoints[0] = new Proxy(
          candidate.polyLines[0]!.mPoints[0]!,
          handler as ProxyHandler<MHPoint2>,
        )
      }
      if (slot === "bounds") {
        solver.bounds = new Proxy(
          solver.bounds,
          handler as ProxyHandler<typeof solver.bounds>,
        )
      }
      if (slot === "prototype") {
        Object.setPrototypeOf(
          solver,
          new Proxy(Object.getPrototypeOf(solver), handler),
        )
      }
      if (slot === "receiver") {
        const method = solver._step
        const proxy = new Proxy(solver, handler)
        solver._step = (): void => {
          method.call(proxy)
        }
      }
    })
  }

  comparePatchedStep((calls): (() => void) => {
    const descriptor = Object.getOwnPropertyDescriptor(Array, Symbol.species)!
    Object.defineProperty(Array, Symbol.species, {
      configurable: true,
      get(): ArrayConstructor {
        calls.count++
        return Array
      },
    })
    return (): void => {
      Object.defineProperty(Array, Symbol.species, descriptor)
    }
  })
  comparePatchedStep((calls): (() => void) => {
    const iteratorPrototype = Object.getPrototypeOf([][Symbol.iterator]())
    const next = iteratorPrototype.next
    iteratorPrototype.next = function (
      this: ArrayIterator<unknown>,
    ): IteratorResult<unknown> {
      calls.count++
      return next.call(this)
    }
    return (): void => {
      iteratorPrototype.next = next
    }
  })
  comparePatchedStep((calls): (() => void) => {
    Object.defineProperty(Object.prototype, Symbol.iterator, {
      configurable: true,
      value: function* (this: { length?: number }): Generator<undefined> {
        calls.count++
        for (let index = 0; index < (this.length ?? 0); index++) yield undefined
      },
    })
    return (): void => {
      delete (Object.prototype as Record<PropertyKey, unknown>)[Symbol.iterator]
    }
  })
  comparePatchedStep((calls): (() => void) => {
    Object.defineProperty(Array.prototype, "0", {
      configurable: true,
      set(value: unknown): void {
        calls.count++
        Object.defineProperty(this, "0", {
          value,
          writable: true,
          enumerable: true,
          configurable: true,
        })
      },
    })
    return (): void => {
      delete Array.prototype[0]
    }
  })

  comparePatchedStep((calls): (() => void) => {
    Object.defineProperty(Object.prototype, "get", {
      configurable: true,
      get(): undefined {
        calls.count++
        return undefined
      },
    })
    return (): void => {
      delete (Object.prototype as Record<string, unknown>).get
    }
  })

  const capturedSymbol = Symbol
  comparePatchedStep((calls): (() => void) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Symbol")!
    Object.defineProperty(globalThis, "Symbol", {
      configurable: true,
      get(): SymbolConstructor {
        calls.count++
        return capturedSymbol
      },
    })
    return (): void => {
      Object.defineProperty(globalThis, "Symbol", descriptor)
    }
  })
  comparePatchedStep((calls): (() => void) => {
    const descriptor = Object.getOwnPropertyDescriptor(Math, "sqrt")!
    Object.defineProperty(Math, "sqrt", {
      configurable: true,
      get(): typeof Math.sqrt {
        calls.count++
        return originalSqrt
      },
    })
    return (): void => {
      Object.defineProperty(Math, "sqrt", descriptor)
    }
  })

  comparePublicSteps(createLines(103), (solver, calls): void => {
    const method = solver.applyForcesToPolyLines
    const nested = createLines(104)
    solver.applyForcesToPolyLines = function (lines): ReturnType<typeof method> {
      calls.push(`outer-${arguments.length}`)
      method.call(this, nested)
      return method.call(this, lines)
    }
  })
  comparePublicSteps(createLines(106), (solver, calls): void => {
    const method = solver.applyForcesToPolyLines
    solver.applyForcesToPolyLines = function (lines): ReturnType<typeof method> {
      calls.push(`same-argument-${arguments.length}`)
      method.call(this, lines)
      return method.call(this, lines)
    }
  })
  const readonlyActual = createSolver(MultiHeadPolyLineIntraNodeSolver2, createLines(107))
  const readonlyExpected = createSolver(FrozenD010ForceSolver, createLines(107))
  for (const solver of [readonlyActual, readonlyExpected]) {
    Object.defineProperty(
      solver.candidates[0]!.polyLines[0]!.mPoints[0]!, "x", { writable: false },
    )
    expect(() => solver._step()).toThrow()
    Object.defineProperty(
      solver.lastCandidate!.polyLines[0]!.mPoints[0]!, "x", { writable: true },
    )
  }
  expectExactNumbers(readonlyActual.lastCandidate, readonlyExpected.lastCandidate)
  expectExactNumbers(
    readonlyActual.applyForcesToPolyLines(readonlyActual.lastCandidate!.polyLines),
    readonlyExpected.applyForcesToPolyLines(readonlyExpected.lastCandidate!.polyLines),
  )
  expectExactNumbers(readonlyActual.lastCandidate, readonlyExpected.lastCandidate)

  const throwing = createSolver(MultiHeadPolyLineIntraNodeSolver2, createLines(105))
  const throwSqrt = Math.sqrt
  try {
    Math.sqrt = (): number => {
      throw new Error("custom force callback")
    }
    expect(() => throwing._step()).toThrow("custom force callback")
  } finally {
    Math.sqrt = throwSqrt
  }
  // A thrown callback cannot leave a token permitting a later public call to reuse state.
  const thrownLines = throwing.lastCandidate!.polyLines
  const thrownExpected = structuredClone(thrownLines)
  expectExactNumbers(
    throwing.applyForcesToPolyLines(thrownLines),
    createSolver(FrozenD010ForceSolver, thrownExpected).applyForcesToPolyLines(
      thrownExpected,
    ),
  )
  expectExactNumbers(thrownLines, thrownExpected)

  const overflow = createLines(91)
  overflow[0]!.mPoints[0]!.x = -1e3
  comparePublicSteps(overflow, (): void => {})
})
