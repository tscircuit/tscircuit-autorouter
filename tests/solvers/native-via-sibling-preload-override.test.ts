import { expect, test } from "bun:test"

test("Base overrides installed before importing Native6 are never certified", (): void => {
  const basePath = new URL(
    "../../lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver.ts",
    import.meta.url,
  ).href
  const nativePath = new URL(
    "../../lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost.ts",
    import.meta.url,
  ).href
  for (const variant of ["obstacle", "getter"]) {
    const script = `
      const { SingleHighDensityRouteSolver: Base } = await import(${JSON.stringify(basePath)})
      const variant = ${JSON.stringify(variant)}
      const original = Base.prototype.isNodeTooCloseToObstacle
      let viaCalls = 0
      if (variant === "obstacle") {
        Base.prototype.isNodeTooCloseToObstacle = function (node, margin, isVia, query) {
          if (isVia) {
            viaCalls++
            return node.z % 2 === 0
          }
          return original.call(this, node, margin, isVia, query)
        }
      } else {
        Object.defineProperty(Base.prototype, "viaPenaltyDistance", {
          configurable: true,
          get: () => 0.5,
        })
      }
      const { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost: Native } = await import(${JSON.stringify(nativePath)})
      const solver = new Native({
        connectionName: "current", obstacleRoutes: [],
        minDistBetweenEnteringPoints: 0.2,
        bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
        A: { x: -1, y: 0, z: 0 }, B: { x: 1, y: 0, z: 5 },
        layerCount: 6, nativeViaSiblingClearance: true,
        captureSearchDebug: false,
      })
      solver.exploredNodes.clear()
      if (variant === "getter") {
        const { default: Flatbush } = await import("flatbush")
        const index = new Flatbush(1)
        index.add(100, 100, 101, 101)
        index.finish()
        const search = index.search.bind(index)
        index.search = (...args) => {
          viaCalls++
          return search(...args)
        }
        solver.obstacleViaIndex = index
      }
      const nodes = solver.getNeighbors({ x: 0, y: 0, z: 0, g: 0, h: 0, f: 0, parent: null })
      console.log(JSON.stringify({
        viaCalls,
        reuse: solver.reuseViaSiblingClearance,
        targets: nodes.filter((node) => node.z !== 0).map((node) => node.z),
      }))
    `
    const child = Bun.spawnSync([process.execPath, "--eval", script])
    expect(child.exitCode).toBe(0)
    expect(JSON.parse(child.stdout.toString())).toEqual({
      viaCalls: variant === "obstacle" ? 5 : 13,
      reuse: false,
      targets: variant === "obstacle" ? [1, 3, 5] : [1, 2, 3, 4, 5],
    })
  }
})
