import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver5 } from "lib/autorouter-pipelines/AutoroutingPipeline5_HdCache/AutoroutingPipelineSolver5_HdCache"
import { Pipeline5HdCacheHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline5_HdCache/Pipeline5HdCacheHighDensitySolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types"

const srj: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.15,
  nominalTraceWidth: 0.6,
  minViaDiameter: 0.3,
  obstacles: [],
  connections: [
    {
      name: "conn1",
      pointsToConnect: [
        { x: -0.5, y: 0, layer: "top" },
        { x: 0.5, y: 0, layer: "top" },
      ],
    },
  ],
  bounds: {
    minX: -5,
    maxX: 5,
    minY: -5,
    maxY: 5,
  },
}

const nodeWithPortPoints: NodeWithPortPoints = {
  capacityMeshNodeId: "cmn_1",
  center: { x: 0, y: 0 },
  width: 2,
  height: 2,
  portPoints: [
    {
      connectionName: "conn1",
      x: -0.5,
      y: 0,
      z: 0,
    },
    {
      connectionName: "conn1",
      x: 0.5,
      y: 0,
      z: 0,
    },
  ],
}

const remoteEligibleNode: NodeWithPortPoints = {
  capacityMeshNodeId: "cmn_remote_width",
  center: { x: 0, y: 0 },
  width: 4,
  height: 3,
  availableZ: [0, 1],
  portPoints: [
    { x: -2, y: -1.5, z: 0, connectionName: "A" },
    { x: 2, y: -1.5, z: 0, connectionName: "A" },
    { x: -2, y: 0, z: 1, connectionName: "B" },
    { x: 2, y: 0, z: 1, connectionName: "B" },
    { x: -2, y: 1.5, z: 0, connectionName: "C" },
    { x: 2, y: 1.5, z: 0, connectionName: "C" },
  ],
}

test("pipeline5 passes top-level nominalTraceWidth into the high-density step", () => {
  const solver = new AutoroutingPipelineSolver5(structuredClone(srj))
  solver.srjWithPointPairs = srj
  solver.portPointPathingSolver = {
    getOutput: () => ({
      nodesWithPortPoints: [nodeWithPortPoints],
      inputNodeWithPortPoints: [],
    }),
  } as any

  const highDensityStep = solver.pipelineDef.find(
    (step) => step.solverName === "highDensityRouteSolver",
  )
  const [highDensityParams] = highDensityStep!.getConstructorParams(
    solver,
  ) as any

  expect(highDensityParams.traceWidth).toBe(0.6)
})

test("pipeline5 keeps non-default trace widths local because hd-cache is width agnostic", () => {
  let fetchCallCount = 0
  const fetchImpl = Object.assign(
    async () => {
      fetchCallCount += 1
      throw new Error("non-default trace widths should not reach hd-cache")
    },
    {
      preconnect: () => {},
    },
  ) as typeof fetch

  const solver = new Pipeline5HdCacheHighDensitySolver({
    nodePortPoints: [remoteEligibleNode],
    traceWidth: 0.6,
    fetchImpl,
  })

  const localSolveCalls: Array<{
    node: NodeWithPortPoints
    nodeIndex: number
  }> = []
  ;(solver as any).solveNodeLocally = (
    node: NodeWithPortPoints,
    nodeIndex: number,
  ) => {
    localSolveCalls.push({ node, nodeIndex })
  }
  ;(solver as any).launchRemoteSolves()

  expect(fetchCallCount).toBe(0)
  expect(localSolveCalls).toEqual([
    {
      node: remoteEligibleNode,
      nodeIndex: 0,
    },
  ])
  expect(solver.stats.remoteRequestsStarted).toBe(0)
  expect(solver.pendingEffects).toEqual([])
})

test("pipeline5 still sends default-width eligible nodes to hd-cache", () => {
  const solver = new Pipeline5HdCacheHighDensitySolver({
    nodePortPoints: [remoteEligibleNode],
    traceWidth: 0.15,
  })

  const localSolveCalls: Array<NodeWithPortPoints> = []
  const remoteSolveCalls: Array<{
    node: NodeWithPortPoints
    nodeIndex: number
  }> = []
  ;(solver as any).solveNodeLocally = (node: NodeWithPortPoints) => {
    localSolveCalls.push(node)
  }
  ;(solver as any).solveNodeViaHdCache = (
    node: NodeWithPortPoints,
    nodeIndex: number,
  ) => {
    remoteSolveCalls.push({ node, nodeIndex })
    return Promise.resolve()
  }
  ;(solver as any).launchRemoteSolves()

  expect(localSolveCalls).toEqual([])
  expect(remoteSolveCalls).toEqual([
    {
      node: remoteEligibleNode,
      nodeIndex: 0,
    },
  ])
  expect(solver.stats.remoteRequestsStarted).toBe(1)
  expect(solver.pendingEffects).toHaveLength(1)
})
