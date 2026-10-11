import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import cn705 from "fixtures/legacy/assets/cn705-nodeWithPortPoints.json"
import { executeMultiHeadHistoryJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/executeMultiHeadHistoryJob"
import type { MultiHeadHistoryJob, MultiHeadStepSnapshot } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelMultiHeadHistoryTypes"
import { ReplayMultiHeadPolyLineSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ReplayMultiHeadPolyLineSolver"
import { MultiHeadPolyLineIntraNodeSolver3 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

function readSnapshot(solver: MultiHeadPolyLineIntraNodeSolver3): MultiHeadStepSnapshot {
  return {
    iterations: solver.iterations,
    maxIterations: solver.MAX_ITERATIONS,
    solved: solver.solved,
    failed: solver.failed,
    error: solver.error,
    progress: solver.progress,
  }
}

test("multi-head histories reveal exact serial prefixes, terminal failures and final acceptance", async (): Promise<void> => {
  const crossing: NodeWithPortPoints = {
    capacityMeshNodeId: "history-crossing-nonadjacent-layers",
    center: { x: 0, y: 0 }, width: 6, height: 6, availableZ: [0, 3],
    portPoints: [
      { connectionName: "A", rootConnectionName: "root_A", pcb_port_id: "a_start", x: -2.5, y: -2.5, z: 0 },
      { connectionName: "A", rootConnectionName: "root_A", pcb_port_id: "a_end", x: 2.5, y: 2.5, z: 0 },
      { connectionName: "B", rootConnectionName: "root_B", pcb_port_id: "b_start", x: -2.5, y: 2.5, z: 0 },
      { connectionName: "B", rootConnectionName: "root_B", pcb_port_id: "b_end", x: 2.5, y: -2.5, z: 0 },
    ],
  }
  const cases = [
    { node: crossing, padding: 0.05, finalGap: undefined },
    { node: cn705.nodeWithPortPoints as NodeWithPortPoints, padding: -0.05, finalGap: undefined },
    { node: cn705.nodeWithPortPoints as NodeWithPortPoints, padding: -0.05, finalGap: -1_000_000 },
  ]
  let observedFailure = false
  let observedFinalAcceptance = false
  for (const [candidateId, fixture] of cases.entries()) {
    const job: MultiHeadHistoryJob = {
      kind: "multiHeadHistory", candidateId,
      params: {
        nodeWithPortPoints: structuredClone(fixture.node), viaDiameter: 0.3,
        hyperParameters: {
          MULTI_HEAD_POLYLINE_SOLVER: true, SEGMENTS_PER_POLYLINE: 6,
          BOUNDARY_PADDING: fixture.padding,
          ...(fixture.finalGap === undefined ? {} : { MINIMUM_FINAL_ACCEPTANCE_GAP: fixture.finalGap }),
        },
      },
      connectivityNetMap: { root_A: ["root_A", "A"], root_B: ["root_B", "B"] },
      connectivityIdToNetMap: { root_A: "root_A", A: "root_A", root_B: "root_B", B: "root_B" },
    }
    const originalParams = structuredClone(job.params)
    const history = executeMultiHeadHistoryJob(job)
    expect(job.params).toEqual(originalParams)
    const params = { ...job.params, connMap: new ConnectivityMap(job.connectivityNetMap) }
    const serial = new MultiHeadPolyLineIntraNodeSolver3(params)
    const replay = new ReplayMultiHeadPolyLineSolver(params)
    replay.setHistoryRequest(Promise.resolve(history))
    await replay.prepareForNextStep()
    expect(history.initial).toEqual(readSnapshot(serial))
    expect(readSnapshot(replay)).toEqual(readSnapshot(serial))
    expect(replay.solvedRoutes).toEqual(serial.solvedRoutes)
    for (const expectedStep of history.steps) {
      serial.step()
      await replay.prepareForNextStep()
      replay.step()
      expect(readSnapshot(serial)).toEqual(expectedStep)
      expect(readSnapshot(replay)).toEqual(expectedStep)
      expect(replay.solvedRoutes).toEqual(serial.solvedRoutes)
    }
    expect(serial.solved || serial.failed).toBe(true)
    if (fixture.node.capacityMeshNodeId === "cn705") {
      expect(serial.iterations).toBe(serial.MAX_ITERATIONS + 1)
      expect(serial.solved).toBe(fixture.finalGap !== undefined)
    }
    expect(history.solvedRoutes).toEqual(serial.solvedRoutes)
    expect(replay.solvedRoutes).toEqual(serial.solvedRoutes)
    const terminalSnapshot = readSnapshot(replay)
    replay.step()
    expect(readSnapshot(replay)).toEqual(terminalSnapshot)
    observedFailure ||= serial.failed
    observedFinalAcceptance ||= fixture.finalGap !== undefined && serial.solved
  }
  expect(observedFailure).toBe(true)
  expect(observedFinalAcceptance).toBe(true)
})
