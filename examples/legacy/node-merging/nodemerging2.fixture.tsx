import { useState, useEffect, useRef } from "react"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { SingleLayerNodeMergerSolver } from "lib/solvers/SingleLayerNodeMerger/SingleLayerNodeMergerSolver"
import nodemerging2 from "../assets/nodemerging2.json"
import { CapacityMeshNode } from "lib/types"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts"
import { BaseSolver } from "lib/solvers/BaseSolver"

const STORAGE_KEY = "nodemerging2_durations"

export default () => {
  const startTimeRef = useRef<number | null>(null)
  const [durations, setDurations] = useState<number[]>([])

  // Load durations from localStorage on component mount
  useEffect(() => {
    const storedDurations = localStorage.getItem(STORAGE_KEY)
    if (storedDurations) {
      setDurations(JSON.parse(storedDurations))
    }
  }, [])

  const handleSolverStarted = (solver: BaseSolver) => {
    startTimeRef.current = performance.now()
  }

  const handleSolverCompleted = (solver: BaseSolver) => {
    if (startTimeRef.current) {
      const duration = performance.now() - startTimeRef.current
      const newDurations = [...durations, duration]
      setDurations(newDurations)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newDurations))
    }
  }

  const clearDurations = () => {
    localStorage.removeItem(STORAGE_KEY)
    setDurations([])
  }

  const chartData = durations.map((duration, index) => ({
    run: index + 1,
    duration: duration / 1000, // Convert to seconds
  }))

  return (
    <div>
      <GenericSolverDebugger
        createSolver={() => {
          return new SingleLayerNodeMergerSolver(nodemerging2[0] as any)
        }}
        onSolverStarted={handleSolverStarted}
        onSolverCompleted={handleSolverCompleted}
      />

      <div className="mt-8 p-4 border rounded-md">
        <div className="flex justify-between mb-4">
          <h3 className="text-lg font-bold">Solver Performance History</h3>
          <button
            className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600"
            onClick={clearDurations}
          >
            Clear History
          </button>
        </div>

        {durations.length > 0 ? (
          <div>
            <LineChart width={600} height={300} data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="run"
                label={{
                  value: "Run Number",
                  position: "insideBottom",
                  offset: -5,
                }}
              />
              <YAxis
                label={{
                  value: "Duration (seconds)",
                  angle: -90,
                  position: "insideLeft",
                }}
              />
              <Tooltip
                formatter={(value) => [
                  `${(value as any).toFixed(2)}s`,
                  "Duration",
                ]}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="duration"
                stroke="#8884d8"
                activeDot={{ r: 8 }}
              />
            </LineChart>
            <div className="mt-2 text-sm text-gray-600">
              Average:{" "}
              {(
                durations.reduce((a, b) => a + b, 0) /
                durations.length /
                1000
              ).toFixed(2)}
              s | Latest: {(durations[durations.length - 1] / 1000).toFixed(2)}s
            </div>
          </div>
        ) : (
          <div className="text-gray-500 italic">
            No solver runs recorded yet
          </div>
        )}
      </div>
    </div>
  )
}
