import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import path from "node:path"

test("owned certificate guards reject changes before the Native6 module loads", () => {
  const baseFile = path.resolve(
    import.meta.dir,
    "../../lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver.ts",
  )
  const nativeFile = path.resolve(
    import.meta.dir,
    "../../lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost.ts",
  )
  for (const mode of ["getter", "key"]) {
    const script = `
      const mode = ${JSON.stringify(mode)}
      const { SingleHighDensityRouteSolver: Base, nativeSingleRouteMethods } = await import(${JSON.stringify(baseFile)})
      let calls = 0
      if (mode === "getter") {
        Object.defineProperty(Base.prototype, "viaPenaltyDistance", {
          configurable: true, get() { calls++; return 4 },
        })
      } else {
        Base.prototype.getNodeKey = function(node) {
          calls++
          return nativeSingleRouteMethods.getNodeKey.call(this, node) + 1
        }
      }
      const { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost: Native } = await import(${JSON.stringify(nativeFile)})
      const points = [{ x: 0, y: 0, z: 1 }, { x: 10, y: 10, z: 2 }]
      const solver = new Native({
        connectionName: "active", obstacleRoutes: [], minDistBetweenEnteringPoints: 0.1,
        bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
        A: { x: -1, y: -1, z: 0 }, B: { x: 1, y: 1, z: 1 },
        futureConnections: [{ connectionName: "future", points }],
        useFuturePointCertificates: true, captureSearchDebug: false,
      })
      if (solver.useFuturePointCertificates) throw new Error("Patched method was blessed")
      for (const x of [0.001, 0.002]) {
        const before = calls
        const selected = solver.getClosestFutureConnectionPoint({ x, y: 0, z: 0, g: 0, h: 0, f: 0, parent: null })
        if (selected !== points[0]) throw new Error("Changed original point identity")
        if (calls - before !== (mode === "getter" ? 3 : 1)) throw new Error("Changed original hook calls")
      }
      if (solver.futurePointAnchors.length) throw new Error("Custom method created an anchor")
      if (!Object.isFrozen(nativeSingleRouteMethods)) throw new Error("Mutable canonical method identities")
    `
    const result = spawnSync(process.execPath, ["--eval", script], {
      cwd: path.resolve(import.meta.dir, "../.."),
      encoding: "utf8",
    })
    expect(result.stderr).toBe("")
    expect(result.status).toBe(0)
  }
})
