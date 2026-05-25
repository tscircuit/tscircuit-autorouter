import { HighDensityInteractiveNodeDebugger } from "lib/testing/HighDensityInteractiveNodeDebugger"
import {
  createPortPointPairsFromPortPoints,
  getPortPointsFromNodeWithPortPoints,
} from "lib/utils/getPortPointsFromNodeWithPortPoints"
import cmn159NodeData from "./cmn_159-node-data.json" with { type: "json" }

const { portPoints: inputPortPoints, ...nodeData } =
  cmn159NodeData.nodeWithPortPoints
const nodeWithPortPoints = {
  ...nodeData,
  portPointsInPairs: createPortPointPairsFromPortPoints(inputPortPoints as any),
}
const outputPortPoints = getPortPointsFromNodeWithPortPoints(
  nodeWithPortPoints as any,
)
const outputConnectionCount = new Set(
  outputPortPoints.map((point: any) => point.connectionName),
).size

export default () => {
  return (
    <div className="p-2">
      <div className="mb-2 text-sm">
        dataset01 circuit102 extracted failing high-density node `cmn_159`
      </div>
      <div className="mb-2 text-xs text-gray-700">
        Output node: {outputPortPoints.length} port points across{" "}
        {outputConnectionCount} named connections, all constrained to `z=1` with
        `availableZ: [1]` inside a `1.56mm x 0.46mm` node.
      </div>
      <div className="mb-3 text-xs text-gray-700">
        Raw input node creation data still has{" "}
        {cmn159NodeData.inputNodeWithPortPoints.portPoints.length} input port
        points, including four `ce504` points that collapse into the final
        four-point `source_net_3_mst1` branch.
      </div>
      <details className="mb-3 text-xs">
        <summary>Show raw capacity node + input node creation data</summary>
        <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-gray-100 p-2">
          {JSON.stringify(
            {
              nodeId: cmn159NodeData.nodeId,
              capacityMeshNode: cmn159NodeData.capacityMeshNode,
              inputNodeWithPortPoints: cmn159NodeData.inputNodeWithPortPoints,
            },
            null,
            2,
          )}
        </pre>
      </details>
      <HighDensityInteractiveNodeDebugger
        nodeWithPortPoints={nodeWithPortPoints as any}
      />
    </div>
  )
}
