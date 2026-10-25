import { expect, test } from "bun:test"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import { detailedPriority, priorityParams } from "./priorityDagTestUtils"

test("exact endpoint vias reuse unchanged native guards/context, and rejected checks continue to charged native Single", () =>
  detailedPriority(() => {
    for (const blocked of [false, true]) {
      const params = priorityParams()
      params.nodeWithPortPoints.portPoints =
        params.nodeWithPortPoints.portPoints.map((p) =>
          p.connectionName === "c"
            ? { ...p, x: 2.2, y: 2.2, z: p.pcb_port_id === "c-0" ? 0 : 1 }
            : blocked && p.connectionName === "a"
              ? { ...p, x: p.pcb_port_id === "a-0" ? 1 : 2.8, y: 2.2 }
              : p,
        )
      const solver = new PriorityDagIntraNodeSolver(params)
      const tasks = Reflect.get(solver, "tasks")
      const state = {
        ancestors: tasks.map(() => new Set()),
        witnesses: tasks.map(() => undefined),
      }
      const opts = Reflect.get(solver, "getOptions").call(solver, 0, state)
      const native = new IntraNodeRouteSolver(params)
      native.unsolvedConnections = opts.futureConnections
      native.solvedRoutes = opts.obstacleRoutes
      const accepted = Reflect.get(native, "trySolveSamePointLayerChange").call(
        native,
        tasks[0],
      )
      expect(accepted).toBe(!blocked)
      Reflect.get(solver, "startTask").call(solver, 0, state)
      expect(solver.solvedRoutes).toHaveLength(0)
      expect(solver.priorityDiagnostics.priorityEndpointViaAttempts).toBe(1)
      expect(
        solver.priorityDiagnostics.priorityEndpointViaGuardUpperBound,
      ).toBe(2)
      expect(
        solver.priorityDiagnostics.priorityEndpointViaSetupPrimitives,
      ).toBeGreaterThan(0)
      if (accepted) {
        expect(state.witnesses[0].route).toEqual(native.solvedRoutes[0])
        expect(solver.activeSubSolver).toBeNull()
        expect(
          solver.priorityDiagnostics.priorityNativeSearches,
        ).toBeUndefined()
        expect(
          Reflect.get(solver, "validateRoute").call(solver, 0, state),
        ).toBe(true)
      } else {
        expect(state.witnesses[0]).toBeUndefined()
        expect(solver.activeSubSolver?.constructor.name).toBe(
          "SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost",
        )
        expect(solver.activeSubSolver?.MAX_ITERATIONS).toBe(10000)
        expect(
          solver.priorityDiagnostics.priorityNativeSetupPrimitives,
        ).toBeGreaterThan(0)
      }
    }
  }))
