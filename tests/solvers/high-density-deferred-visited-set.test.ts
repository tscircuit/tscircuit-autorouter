import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"

test("deferred visited storage exposes a live native Set with original insertion order", () => {
  const makeSolver = (): SingleHighDensityRouteSolver =>
    new SingleHighDensityRouteSolver({
      connectionName: "route",
      obstacleRoutes: [],
      minDistBetweenEnteringPoints: 0.15,
      bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
      A: { x: -2, y: -1, z: 0 },
      B: { x: 2, y: 1, z: 1 },
      layerCount: 2,
    })
  type Internal = {
    hasExploredNode(key: number): boolean
    addExploredNode(key: number): void
    exploredNodeBitmap: Uint8Array | null | undefined
  }
  for (const mode of ["normal", "replacement", "subclass-field", "custom-keys"]) {
    const solver = makeSolver()
    const internal = solver as unknown as Internal
    let reference = new Set<number>()
    if (mode === "replacement") solver.exploredNodes = new Set()
    if (mode === "subclass-field") {
      Object.defineProperty(solver, "exploredNodes", {
        configurable: true,
        enumerable: true,
        writable: true,
        value: new Set(),
      })
    }
    if (mode === "custom-keys") solver.getNodeKey = () => 1
    for (let index = 0; index < 4_000; index++) {
      const key = (index * 713) % 1_000
      expect(internal.hasExploredNode(key)).toBe(reference.has(key))
      internal.addExploredNode(key)
      reference.add(key)
    }
    if (mode === "normal") {
      expect(Object.getOwnPropertyDescriptor(solver, "exploredNodes")?.get).toBeFunction()
      expect(internal.exploredNodeBitmap).toBeInstanceOf(Uint8Array)
    }
    const visible = solver.exploredNodes
    expect(visible).toBeInstanceOf(Set)
    expect([...visible]).toEqual([...reference])
    expect(solver.exploredNodes).toBe(visible)
    Set.prototype.delete.call(visible, 0)
    reference.delete(0)
    expect(internal.hasExploredNode(0)).toBe(false)
    for (const key of [-0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
      Set.prototype.add.call(visible, key)
      reference.add(key)
      expect(internal.hasExploredNode(key)).toBe(true)
    }
    expect([...solver.exploredNodes]).toEqual([...reference])
    solver.exploredNodes = new Set([11, 12])
    reference = new Set([11, 12])
    expect(internal.hasExploredNode(11)).toBe(true)
    expect(internal.hasExploredNode(0)).toBe(false)
    internal.addExploredNode(13)
    reference.add(13)
    expect([...solver.exploredNodes]).toEqual([...reference])
    solver.exploredNodes.clear()
    expect(internal.hasExploredNode(13)).toBe(false)
  }
  class MaterializingParent extends SingleHighDensityRouteSolver {
    constructor() {
      const template = makeSolver()
      super({
        connectionName: "route",
        obstacleRoutes: [],
        minDistBetweenEnteringPoints: 0.15,
        bounds: template.bounds,
        A: template.A,
        B: template.B,
        layerCount: 2,
      })
      void this.exploredNodes
    }
  }
  class SetFieldChild extends MaterializingParent {
    override exploredNodes = new Set([42])
  }
  const child = new SetFieldChild()
  expect((child as unknown as Internal).hasExploredNode(42)).toBe(true)
  child.exploredNodes = new Set([43])
  expect((child as unknown as Internal).hasExploredNode(43)).toBe(true)
  expect((child as unknown as Internal).hasExploredNode(42)).toBe(false)
  for (const getter of [false, true]) {
    const solver = makeSolver()
    const internal = solver as unknown as Internal
    internal.addExploredNode(1)
    const replacement = new Set([42])
    let getterCalls = 0
    Object.defineProperty(solver, "exploredNodes", getter ? {
      configurable: true,
      enumerable: true,
      get: () => {
        getterCalls++
        return replacement
      },
    } : {
      configurable: true,
      enumerable: true,
      writable: true,
      value: replacement,
    })
    expect(internal.hasExploredNode(1)).toBe(false)
    expect(internal.hasExploredNode(42)).toBe(true)
    internal.addExploredNode(43)
    expect([...replacement]).toEqual([42, 43])
    expect(getterCalls).toBe(getter ? 3 : 0)
  }
  for (const key of [-0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    const solver = makeSolver()
    const internal = solver as unknown as Internal
    internal.addExploredNode(5)
    internal.addExploredNode(key)
    internal.addExploredNode(7)
    expect(internal.hasExploredNode(key)).toBe(true)
    expect([...solver.exploredNodes]).toEqual([...new Set([5, key, 7])])
  }
})
