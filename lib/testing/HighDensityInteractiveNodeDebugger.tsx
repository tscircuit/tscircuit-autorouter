import { useState } from "react"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { HyperHighDensityDebugger } from "lib/testing/HyperHighDensityDebugger"
import CapacityNodeEditor from "lib/testing/CapacityNodeEditor"

export interface HighDensityInteractiveNodeDebuggerProps {
  nodeWithPortPoints: NodeWithPortPoints
}

export const HighDensityInteractiveNodeDebugger = ({
  nodeWithPortPoints,
}: HighDensityInteractiveNodeDebuggerProps) => {
  const [editableNode, setEditableNode] = useState<NodeWithPortPoints>(() => ({
    ...nodeWithPortPoints,
    portPoints: nodeWithPortPoints.portPoints.map((p) => ({ ...p })),
  }))
  const [mode, setMode] = useState<"build" | "solve">("build")
  const [animationSpeed, setAnimationSpeed] = useState<number>(10)
  const [solverAction, setSolverAction] = useState<
    "reset" | "step" | "animate" | "solve" | null
  >(null)

  return (
    <div className="flex flex-col h-screen">
      <div className="p-2 border-b bg-white flex items-center justify-between shadow-sm z-10">
        <div className="flex gap-2">
          <button
            className="px-3 py-1 text-sm rounded bg-gray-200 hover:bg-gray-300"
            onClick={() => {
              setMode("build")
              setSolverAction(null)
            }}
          >
            Reset
          </button>
          <button
            className="px-3 py-1 text-sm rounded bg-gray-200 hover:bg-gray-300"
            onClick={() => {
              setMode("solve")
              setSolverAction("step")
            }}
          >
            Step
          </button>
          <button
            className={`px-3 py-1 text-sm rounded ${
              mode === "solve" && solverAction === "animate"
                ? "bg-blue-600 text-white"
                : "bg-gray-200 hover:bg-gray-300"
            }`}
            onClick={() => {
              if (mode === "solve" && solverAction === "animate") {
                setSolverAction(null)
              } else {
                setMode("solve")
                setSolverAction("animate")
              }
            }}
          >
            Animate
          </button>
          <button
            className="px-3 py-1 text-sm rounded bg-gray-200 hover:bg-gray-300"
            onClick={() => {
              setMode("solve")
              setSolverAction("solve")
            }}
          >
            Solve
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs">Speed:</span>
          <select
            className="px-2 py-1 text-sm border rounded"
            value={animationSpeed}
            onChange={(e) => setAnimationSpeed(Number(e.target.value))}
          >
            <option value={1000}>1000ms</option>
            <option value={500}>500ms</option>
            <option value={250}>250ms</option>
            <option value={100}>100ms (1x)</option>
            <option value={25}>25ms (4x)</option>
            <option value={10}>10ms (10x)</option>
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-hidden relative">
        {mode === "build" ? (
          <CapacityNodeEditor
            onNodeChange={setEditableNode}
            initialNode={nodeWithPortPoints}
          />
        ) : (
          <div className="h-full overflow-auto p-4">
            <HyperHighDensityDebugger
              nodeWithPortPoints={editableNode}
              solverAction={solverAction}
              animationSpeed={animationSpeed}
              onActionComplete={() => setSolverAction(null)}
            />
          </div>
        )}
      </div>
    </div>
  )
}
