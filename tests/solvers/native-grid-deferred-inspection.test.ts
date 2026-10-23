import { expect, test } from "bun:test"
import { HighDensitySolverA01, HighDensitySolverA03 } from "@tscircuit/high-density-a01"
import { createNativeGridSetupDiagnostics, deferNativeGridSetup } from "lib/solvers/HyperHighDensitySolver/deferNativeGridSetup"

test("native inspection preserves original views and only materializes grid-dependent views without advancing search", (): void => {
  for (const family of ["a01", "a03"] as const) {
    for (const inspection of ["gridStats", "solvedConnectionsMap", "unsolvedConnections", "activeConnection", "openSet", "visualize", "preview", "getOutput"] as const) {
      const props = { nodeWithPortPoints: { capacityMeshNodeId: "inspection", center: { x: 0, y: 0 }, width: 2, height: 2, availableZ: [0, 1], portPoints: [
        { connectionName: "wire", rootConnectionName: "root", x: -1, y: 0, z: 0 },
        { connectionName: "wire", rootConnectionName: "root", x: 1, y: 0, z: 1 },
      ] }, cellSizeMm: 0.1, highResolutionCellSize: 0.1, lowResolutionCellSize: 0.4, viaDiameter: 0.3, traceThickness: 0.15 }
      const eager = family === "a01" ? new HighDensitySolverA01(props) : new HighDensitySolverA03(props)
      const deferred = family === "a01" ? new HighDensitySolverA01(props) : new HighDensitySolverA03(props)
      eager.setup()
      eager.MAX_ITERATIONS = Math.min(eager.MAX_ITERATIONS, 150_000)
      const diagnostics = createNativeGridSetupDiagnostics()
      expect(deferNativeGridSetup(deferred, 150_000, diagnostics)).toBe(true)
      expect((deferred as any)._setupDone).toBe(false)
      const eagerValue = (eager as any)[inspection]
      const deferredValue = (deferred as any)[inspection]
      expect(typeof eagerValue === "function" ? deferredValue.call(deferred) : deferredValue).toEqual(typeof eagerValue === "function" ? eagerValue.call(eager) : eagerValue)
      expect(deferred.iterations).toBe(0)
      expect(deferred.progress).toBe(eager.progress)
      expect(deferred.MAX_ITERATIONS).toBe(eager.MAX_ITERATIONS)
      expect(deferred.getSolverName()).toBe(eager.getSolverName())
      expect(deferred.stats).toEqual(eager.stats)
      expect(diagnostics.materializedCandidateCount).toBe(inspection === "preview" ? 0 : 1)
      expect(diagnostics.selectedCandidateCount).toBe(0)
      eager.solve()
      deferred.solve()
      expect(deferred.solved).toBe(eager.solved)
      expect(deferred.failed).toBe(eager.failed)
      expect(deferred.iterations).toBe(eager.iterations)
      expect(deferred.getOutput()).toEqual(eager.getOutput())
    }
  }
})
