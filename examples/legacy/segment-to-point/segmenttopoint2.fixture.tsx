import { InteractiveGraphics } from "graphics-debug/react"
import { CapacitySegmentToPointSolver } from "lib/solvers/CapacityMeshSolver/CapacitySegmentToPointSolver"
import { CapacitySegmentPointOptimizer } from "lib/solvers/CapacitySegmentPointOptimizer/CapacitySegmentPointOptimizer"
import inputs from "examples/legacy/assets/segmenttopoint1.json"
import { useEffect, useMemo, useReducer, useState, useCallback } from "react"
import { combineVisualizations } from "lib/utils/combineVisualizations"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"

const initialPointSolver = new CapacitySegmentToPointSolver(
  JSON.parse(JSON.stringify(inputs)),
)
initialPointSolver.solve()

export default () => {
  const [pressCount, incPressCount] = useReducer((p) => p + 1, 0)
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set())
  const [isAnimating, setIsAnimating] = useState(false)
  const [fastAnimation, setFastAnimation] = useState(false)
  const [iterationHistory, setIterationHistory] = useState<
    { iteration: number; probability: number }[]
  >([])

  const { optimizer } = useMemo(() => {
    const optimizer = new CapacitySegmentPointOptimizer({
      assignedSegments: initialPointSolver.solvedSegments,
      colorMap: initialPointSolver.colorMap,
      nodes: inputs.nodes as any,
    })
    // optimizer.step()
    return { optimizer }
  }, [])

  const initialProbabilityOfFailure = useMemo(
    () => optimizer.probabilityOfFailure,
    [],
  )

  const initialNodeCosts = useMemo(() => {
    return [...optimizer.currentNodeCosts.values()].sort().filter((k) => k > 0)
  }, [])

  useEffect(() => {
    let intervalId: number | undefined
    const startTime = Date.now()
    if (isAnimating) {
      intervalId = window.setInterval(() => {
        const timeElapsed = Date.now() - startTime
        for (
          let i = 0;
          i <
          Math.min(
            fastAnimation ? 10000 : 100,
            timeElapsed / (fastAnimation ? 10 : 100),
          );
          i++
        ) {
          if (optimizer.solved) {
            clearInterval(intervalId)
            break
          }
          optimizer.step()
        }
        setIterationHistory((prev) => {
          const newPoint = {
            iteration: optimizer.iterations,
            probability: optimizer.probabilityOfFailure,
          }

          if (prev.length > 1000) {
            // Keep every 4th point to reduce to ~250 points
            return [...prev.filter((_, i) => i % 4 === 0), newPoint]
          }

          return [...prev, newPoint]
        })
      }, 10)
    }
    return () => {
      if (intervalId !== undefined) {
        clearInterval(intervalId)
      }
    }
  }, [isAnimating])

  useEffect(() => {
    if (pressCount === 0) return
    if (optimizer.solved || optimizer.failed) return
    optimizer.step()
    setIterationHistory((prev) => [
      ...prev,
      {
        iteration: optimizer.iterations,
        probability: optimizer.probabilityOfFailure,
      },
    ])
  }, [pressCount])

  const highestFailureNodes = useMemo(() => {
    return [...optimizer.currentNodeCosts.entries()]
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
  }, [optimizer.currentNodeCosts])

  const nodeCostsSorted = [...optimizer.currentNodeCosts.values()]
    .sort()
    .filter((k) => k > 0)

  const highlightVisualization = useMemo(() => {
    if (selectedNodeIds.size === 0) return { rects: [] }
    return {
      rects: Array.from(selectedNodeIds).map((nodeId) => {
        const node = optimizer.nodeMap.get(nodeId)!
        return {
          center: node.center,
          width: node.width,
          height: node.height,
          color: "rgba(255, 0, 0, 0.3)",
          stroke: "red",
          strokeWidth: 2,
        }
      }),
    }
  }, [selectedNodeIds])

  const toggleNodeSelection = (nodeId: string) => {
    setSelectedNodeIds((prev) => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }

  return (
    <div>
      <div className="flex gap-2">
        <button className="border rounded-md p-2" onClick={incPressCount}>
          Step
        </button>
        <button
          className="border rounded-md p-2"
          onClick={() => setIsAnimating(!isAnimating)}
        >
          {isAnimating ? "Stop" : "Animate"}
        </button>
        <button
          className="border rounded-md p-2"
          onClick={() => {
            setIsAnimating(true)
            setFastAnimation(!fastAnimation)
          }}
        >
          {isAnimating ? (fastAnimation ? "Slow" : "Fast") : "Animate Fast"}
        </button>
      </div>
      <div className="flex gap-2 tabular-nums">
        <div>Iterations: {optimizer.iterations}</div>
        <div>
          P(failure) {(optimizer.probabilityOfFailure * 100).toFixed(8)}%
        </div>
        <div>Cost: {optimizer.currentCost}</div>
        <div>
          △ P(failure){" "}
          {(
            optimizer.probabilityOfFailure - initialProbabilityOfFailure
          ).toFixed(8)}
          %
        </div>
        <div>
          △ P / M Iterations:{" "}
          {(
            ((optimizer.probabilityOfFailure - initialProbabilityOfFailure) /
              optimizer.iterations) *
            1e6
          ).toFixed(1)}
          %
        </div>
      </div>
      <InteractiveGraphics
        graphics={combineVisualizations(
          optimizer.visualize(),
          highlightVisualization,
        )}
      />
      <div className="mt-4 flex">
        <div>
          <h3 className="font-bold">Highest Failure Risk Nodes</h3>
          <table className="border-collapse border">
            <thead>
              <tr>
                <th className="border p-2">Highlight</th>
                <th className="border p-2">Node ID</th>
                <th className="border p-2">P(Failure)</th>
              </tr>
            </thead>
            <tbody>
              {highestFailureNodes.map(([nodeId, cost]) => (
                <tr key={nodeId}>
                  <td className="border p-2">
                    <input
                      type="checkbox"
                      checked={selectedNodeIds.has(nodeId)}
                      onChange={() => toggleNodeSelection(nodeId)}
                    />
                  </td>
                  <td className="border p-2">{nodeId}</td>
                  <td className="border p-2">{(cost * 100).toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="w-full h-96 p-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={iterationHistory}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="iteration"
                label={{ value: "Iterations", position: "bottom", offset: 0 }}
              />
              <YAxis
                label={{
                  value: "Probability of Failure",
                  angle: -90,
                  position: "left",
                }}
                domain={[
                  Math.min(...iterationHistory.map((ih) => ih.probability)),
                  Math.max(...iterationHistory.map((ih) => ih.probability)),
                ]}
                tickFormatter={(value) => value.toFixed(2)}
              />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="probability"
                stroke="#2563eb"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="w-full h-96 p-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={initialNodeCosts.map((n, i) => ({
                index: i,
                value: Math.min(
                  nodeCostsSorted[
                    i - (initialNodeCosts.length - nodeCostsSorted.length)
                  ] ?? 0,
                  1,
                ),
                initialValue: initialNodeCosts[i],
              }))}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="index"
                label={{ value: "Index", position: "bottom", offset: 0 }}
              />
              <YAxis
                label={{ value: "Value", angle: -90, position: "left" }}
                max={1}
                domain={[0, 1]}
              />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="initialValue"
                stroke="#dc2626"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#2563eb"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
