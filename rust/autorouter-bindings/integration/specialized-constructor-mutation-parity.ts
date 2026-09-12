import assert from "node:assert/strict"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SingleTransitionThroughObstacleIntraNodeSolver } from "../../../lib/solvers/HighDensitySolver/SingleTransitionThroughObstacleIntraNodeSolver"
import { MultiHeadPolyLineIntraNodeSolver } from "../../../lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver"
import { importReference } from "./tsReference"

type ThroughProps = ConstructorParameters<typeof SingleTransitionThroughObstacleIntraNodeSolver>[0]
const { SingleTransitionThroughObstacleIntraNodeSolver: ReferenceThrough } = await importReference<{ SingleTransitionThroughObstacleIntraNodeSolver: typeof SingleTransitionThroughObstacleIntraNodeSolver }>("lib/solvers/HighDensitySolver/SingleTransitionThroughObstacleIntraNodeSolver.ts")
const { MultiHeadPolyLineIntraNodeSolver: ReferenceMulti } = await importReference<{ MultiHeadPolyLineIntraNodeSolver: typeof MultiHeadPolyLineIntraNodeSolver }>("lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver.ts")
const connMap = new ConnectivityMap({ signal: ["signal"], pad: ["pad"] })
const props: ThroughProps = {
  nodeWithPortPoints: { capacityMeshNodeId: "constructor-mutations", center: { x: 0, y: 0 }, width: 4, height: 4, portPoints: [
    { x: -0.5, y: 0, z: 0, connectionName: "signal", portPointId: "start" },
    { x: 0.5, y: 0, z: 1, connectionName: "signal", portPointId: "end" },
  ] },
  obstacles: [{ type: "rect", center: { x: 0, y: 0 }, width: 0.1, height: 0.1, layers: ["top", "bottom"], connectedTo: ["pad"] }],
  connMap, layerCount: 2,
}
function compareThrough(label: string): boolean {
  const actual = new SingleTransitionThroughObstacleIntraNodeSolver(props)
  const expected = new ReferenceThrough(props)
  try {
    actual.solve(); expected.solve()
    assert.equal(actual.solved, expected.solved, `${label}/solved`)
    assert.equal(actual.failed, expected.failed, `${label}/failed`)
    assert.equal(JSON.stringify(actual.solvedRoutes), JSON.stringify(expected.solvedRoutes), `${label}/routes`)
    assert.equal(actual.connMap, connMap)
    assert.equal(actual.obstacles[0]!.connectedTo, props.obstacles![0]!.connectedTo)
    return actual.solved
  } finally { actual.dispose() }
}
assert.equal(compareThrough("initial"), false)
props.obstacles![0]!.width = 3
props.obstacles![0]!.height = 3
assert.equal(compareThrough("same obstacle array mutated"), false)
connMap.idToNetMap.pad = connMap.idToNetMap.signal!
assert.equal(compareThrough("same connectivity object mutated"), true)
props.obstacles![0]!.width = 0.1
assert.equal(compareThrough("obstacle changed again"), false)

const multiProps: ConstructorParameters<typeof MultiHeadPolyLineIntraNodeSolver>[0] = {
  nodeWithPortPoints: { ...props.nodeWithPortPoints, portPoints: [
    { x: -2, y: -1, z: 0, connectionName: "signal" }, { x: 2, y: 1, z: 0, connectionName: "signal" },
    { x: -1, y: 2, z: 0, connectionName: "pad" }, { x: 1, y: -2, z: 0, connectionName: "pad" },
  ] }, connMap,
}
for (const connected of [true, false, true]) {
  connMap.idToNetMap.pad = connected ? connMap.idToNetMap.signal! : "pad"
  const actual = new MultiHeadPolyLineIntraNodeSolver(multiProps)
  const expected = new ReferenceMulti(multiProps)
  try {
    actual.step(); expected.step()
    assert.deepEqual(actual.candidates, expected.candidates, `MultiHead fresh constructor after connectivity mutation ${connected}`)
    assert.equal(actual.connMap, connMap)
  } finally { actual.dispose() }
}
console.log("Direct constructors preserve same-object obstacle/connectivity mutations across instances")
