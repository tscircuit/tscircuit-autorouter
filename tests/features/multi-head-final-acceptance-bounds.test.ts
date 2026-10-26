import { expect, test } from "bun:test"
import { MultiHeadPolyLineIntraNodeSolver3 } from "../../lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"
import type { Candidate } from "../../lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/types1"
import type { NodeWithPortPoints } from "../../lib/types/high-density-types"

test("MultiHead final acceptance preserves normal bounds at its relaxed gap threshold", () => {
  const scale = 8
  const center = { x: 279.56525724, y: 68.82874941 }
  const toScaledPoint = (point: { x: number; y: number; z: number }) => ({
    ...point,
    x: center.x + (point.x - center.x) * scale,
    y: center.y + (point.y - center.y) * scale,
  })
  const ports = [
    { x: 279.411218155, y: 69.07170082, z: 0, connectionName: "signal-a" },
    { x: 279.831957, y: 69.04168324333332, z: 2, connectionName: "signal-a" },
    { x: 279.636539505, y: 69.07170082, z: 0, connectionName: "signal-b" },
    { x: 279.831957, y: 69.04168324333332, z: 1, connectionName: "signal-b" },
  ].map((port) => ({ ...port, ...toScaledPoint(port) }))
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "topology_merge_61252",
    center,
    width: 0.53339952 * scale,
    height: 0.48590282 * scale,
    availableZ: [0, 1, 2, 3, 4, 5, 6, 7],
    portPoints: ports,
    portPointsInPairs: [
      [ports[0]!, ports[1]!],
      [ports[2]!, ports[3]!],
    ],
  }
  const createSolver = (): MultiHeadPolyLineIntraNodeSolver3 =>
    new MultiHeadPolyLineIntraNodeSolver3({
      nodeWithPortPoints: node,
      viaDiameter: 0.3,
      hyperParameters: {
        MULTI_HEAD_POLYLINE_SOLVER: true,
        SEGMENTS_PER_POLYLINE: 6,
        BOUNDARY_PADDING: -0.05,
        ITERATION_PENALTY: 10000,
        MINIMUM_FINAL_ACCEPTANCE_GAP: 0.001,
      },
    })
  const createCandidate = (
    point: { x: number; y: number },
    gap: number,
  ): Candidate => ({
    g: 0,
    h: 0,
    f: 0,
    viaCount: 1,
    minGaps: [gap],
    polyLines: [
      {
        connectionName: "signal-a",
        start: { ...ports[0]!, z1: 0, z2: 0 },
        end: { ...ports[1]!, z1: 2, z2: 2 },
        mPoints: [{ ...point, z1: 0, z2: 2 }],
      },
    ],
  })

  const outside = createSolver()
  outside.lastCandidate = createCandidate(
    { x: center.x, y: outside.bounds.minY - 0.01 * scale },
    0.2,
  )
  expect(outside.failed).toBe(false)
  expect(outside.checkIfSolved(outside.lastCandidate)).toBe(false)
  outside.tryFinalAcceptance()
  expect(outside.solved).toBe(false)
  expect(outside.solvedRoutes).toEqual([])

  const relaxed = createSolver()
  relaxed.lastCandidate = createCandidate(center, 0.01)
  expect(relaxed.checkIfSolved(relaxed.lastCandidate)).toBe(false)
  relaxed.tryFinalAcceptance()
  expect(relaxed.solved).toBe(true)
  expect(relaxed.solvedRoutes[0]?.vias).toEqual([center])

  const insufficientGap = createSolver()
  insufficientGap.lastCandidate = createCandidate(center, 0.0009)
  insufficientGap.tryFinalAcceptance()
  expect(insufficientGap.solved).toBe(false)

  const reducedInset = createSolver()
  reducedInset.lastCandidate = createCandidate(
    { x: reducedInset.bounds.minX + 0.100001, y: center.y },
    0.2,
  )
  expect(reducedInset.checkIfSolved(reducedInset.lastCandidate)).toBe(true)
  reducedInset.tryFinalAcceptance()
  expect(reducedInset.solved).toBe(true)

  const outsideInset = createSolver()
  outsideInset.lastCandidate = createCandidate(
    { x: outsideInset.bounds.minX + 0.099999, y: center.y },
    0.2,
  )
  expect(outsideInset.checkIfSolved(outsideInset.lastCandidate)).toBe(false)
  outsideInset.tryFinalAcceptance()
  expect(outsideInset.solved).toBe(false)
})
