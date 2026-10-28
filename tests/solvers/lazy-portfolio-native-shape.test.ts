import { expect, test } from "bun:test"
import { HighDensitySolverA01, HighDensitySolverA03 } from "@tscircuit/high-density-a01"
import type { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { createLazyPortfolioNode, GridOnlyPortfolio } from "./lazyPortfolioTestUtils"

type OwnShapeEntry = {
  key: PropertyKey
  configurable: boolean | undefined
  enumerable: boolean | undefined
  writable: boolean | undefined
  valueType: string
  getter: (() => unknown) | undefined
  setter: ((value: unknown) => void) | undefined
}

const getOwnShape = (solver: object): OwnShapeEntry[] => {
  return Reflect.ownKeys(solver).map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(solver, key)!
    return { key, configurable: descriptor.configurable, enumerable: descriptor.enumerable,
      writable: descriptor.writable, valueType: typeof descriptor.value,
      getter: descriptor.get, setter: descriptor.set }
  })
}

class ShapePortfolio extends GridOnlyPortfolio {
  readonly nativeShapes = new WeakMap<object, { prototype: object; ownShape: OwnShapeEntry[] }>()

  override generateSolver(hyperParameters: Record<string, any>): IntraNodeRouteSolver {
    const candidate = super.generateSolver(hyperParameters)
    const external: unknown = candidate
    if (external instanceof HighDensitySolverA01 || external instanceof HighDensitySolverA03) {
      this.nativeShapes.set(external, { prototype: Object.getPrototypeOf(external) as object,
        ownShape: getOwnShape(external) })
    }
    return candidate
  }
}

test("deferred inspection preserves native own-property shapes and restores native prototypes before search", (): void => {
  for (const GridSolver of [HighDensitySolverA01, HighDensitySolverA03]) {
    for (const inspected of ["setup", "getOutput", "gridStats"] as const) {
      const params = { nodeWithPortPoints: createLazyPortfolioNode(), traceWidth: 0.1,
        viaDiameter: 0.3, cacheProvider: null }
      const eager = new ShapePortfolio({ ...params, portfolioMode: "eager" })
      const lazy = new ShapePortfolio({ ...params, portfolioMode: "lazy" })
      eager.initializeSolvers()
      lazy.initializeSolvers()
      const before = eager.supervisedSolvers!.find(({ solver }) => solver instanceof GridSolver)!.solver as unknown as HighDensitySolverA01 | HighDensitySolverA03
      const after = lazy.supervisedSolvers!.find(({ solver }) => solver instanceof GridSolver)!.solver as unknown as HighDensitySolverA01 | HighDensitySolverA03
      const native = lazy.nativeShapes.get(after)!
      expect(after._setupDone).toBe(false)
      expect(getOwnShape(after)).toEqual(native.ownShape)
      expect(Object.getPrototypeOf(after)).not.toBe(native.prototype)
      const cachedSetup = after.setup
      const cachedGetOutput = after.getOutput
      const cachedGridStats = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(after), "gridStats")!.get!
      if (inspected === "setup") after.setup()
      else if (inspected === "getOutput") expect(after.getOutput()).toEqual(before.getOutput())
      else expect(after.gridStats).toEqual(before.gridStats)
      expect(after._setupDone).toBe(true)
      expect(Object.getPrototypeOf(after)).toBe(native.prototype)
      expect(getOwnShape(after)).toEqual(getOwnShape(before))
      expect(after.setup).toBe(before.setup)
      expect(after.getOutput).toBe(before.getOutput)
      const completedShape = getOwnShape(after)
      cachedSetup.call(after)
      expect(cachedGetOutput.call(after)).toEqual(before.getOutput())
      expect(cachedGridStats.call(after)).toEqual(before.gridStats)
      expect(getOwnShape(after)).toEqual(completedShape)
      expect(lazy.stats.lazyGridSetupMaterializedCount).toBe(1)
    }
  }
})
