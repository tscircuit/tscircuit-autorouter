import { expect, test } from "bun:test"
import { HighDensitySolverA01, HighDensitySolverA03 } from "@tscircuit/high-density-a01"
import { createNativeGridSetupDiagnostics, deferNativeGridSetup, type NativeGridSetupDiagnostics } from "lib/solvers/HyperHighDensitySolver/deferNativeGridSetup"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("deferred native grids preserve exact setup state, private buffers and caller limits", (): void => {
  for (const width of [0, 0.05, 0.2, 1.1, 2.75]) {
    for (const availableZ of [[], [0], [0, 2], [0, 1, 2, 3]]) {
      for (const hasConnections of [false, true]) {
        const node: NodeWithPortPoints = {
          capacityMeshNodeId: "native-setup-parity", center: { x: 1.25, y: -3.1 }, width, height: width + 0.17,
          availableZ,
          portPoints: hasConnections ? [
            { connectionName: "a", rootConnectionName: "root", portPointId: "a0", nextPortPointId: "a1", x: 1.25 - width / 2, y: -3.1, z: availableZ[0] ?? 0 },
            { connectionName: "a", rootConnectionName: "root", portPointId: "a1", prevPortPointId: "a0", x: 1.25 + width / 2, y: -3.1, z: availableZ.at(-1) ?? 0 },
            { connectionName: "b", rootConnectionName: "root", x: 1.25 - width / 2, y: -3.1, z: availableZ[0] ?? 0 },
            { connectionName: "b", rootConnectionName: "root", x: 1.25 + width / 2, y: -3.1, z: availableZ.at(-1) ?? 0 },
          ] : [],
        }
        for (const family of ["a01", "a03"] as const) {
          for (const limit of [37_500, 150_000, 2_000_000]) {
            const props = { nodeWithPortPoints: node, cellSizeMm: 0.1, highResolutionCellSize: 0.1, highResolutionCellThickness: 8, lowResolutionCellSize: 0.4, viaDiameter: 0.3, traceThickness: 0.15, effort: 0.25 }
            const eager = family === "a01" ? new HighDensitySolverA01(props) : new HighDensitySolverA03(props)
            const deferred = family === "a01" ? new HighDensitySolverA01(props) : new HighDensitySolverA03(props)
            const diagnostics: NativeGridSetupDiagnostics = createNativeGridSetupDiagnostics()
            eager.setup()
            eager.MAX_ITERATIONS = Math.min(eager.MAX_ITERATIONS, limit)
            expect(deferNativeGridSetup(deferred, limit, diagnostics)).toBe(true)
            expect(deferred.MAX_ITERATIONS).toBe(eager.MAX_ITERATIONS)
            expect([deferred.solved, deferred.failed, deferred.error, deferred.iterations, deferred.progress]).toEqual([eager.solved, eager.failed, eager.error, eager.iterations, eager.progress])
            expect(diagnostics.materializationAttemptCount).toBe(0)
            expect((deferred as any)._setupDone).toBe(false)
            deferred.setup()
            deferred.setup()
            expect(diagnostics.materializedCandidateCount).toBe(1)
            expect(deferred.gridStats).toEqual(eager.gridStats)
            expect(diagnostics.deferredPlaneCellCount).toBe(eager.gridStats.cells)
            expect(diagnostics.deferredLayerCellCount).toBe(eager.gridStats.states)
            expect(deferred.getConstructorParams()).toEqual(eager.getConstructorParams())
            for (const key of Object.keys(eager)) {
              const value = (eager as any)[key]
              if (ArrayBuffer.isView(value) || value instanceof Map || value instanceof Set || Array.isArray(value) || value === null || value === undefined || ["number", "boolean", "string"].includes(typeof value)) {
                expect((deferred as any)[key]).toEqual(value)
              }
            }
            // An explicit budget change after preparation has the same meaning
            // as changing an already materialized candidate's limit.
            const changed = family === "a01" ? new HighDensitySolverA01(props) : new HighDensitySolverA03(props)
            expect(deferNativeGridSetup(changed, limit, diagnostics)).toBe(true)
            changed.MAX_ITERATIONS = 3_000_001
            changed.setup()
            expect(changed.MAX_ITERATIONS).toBe(3_000_001)
          }
        }
      }
    }
  }
})
