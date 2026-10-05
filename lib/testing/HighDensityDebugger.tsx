import { InteractiveGraphics } from "graphics-debug/react"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { combineVisualizations } from "lib/utils/combineVisualizations"
import { generateColorMapFromNodeWithPortPoints } from "lib/utils/generateColorMapFromNodeWithPortPoints"
import { useState, useRef, useEffect } from "react"
import type { NodeWithPortPoints } from "../types/high-density-types"
import { HighDensityHyperParameters } from "lib/solvers/HighDensitySolver/HighDensityHyperParameters"

interface HighDensityDebuggerProps {
  startSeed?: number
  nodeWithPortPoints: NodeWithPortPoints
  hyperParameters?: Partial<HighDensityHyperParameters>
}

export const HighDensityDebugger = ({
  startSeed = 0,
  nodeWithPortPoints,
  hyperParameters = {},
}: HighDensityDebuggerProps) => {
  const [shuffleSeed, setShuffleSeed] = useState(startSeed)
  const [isAnimating, setIsAnimating] = useState(false)
  const [maxSolvedRoutes, setMaxSolvedRoutes] = useState(0)
  const [bestSeed, setBestSeed] = useState(0)
  const animationRef = useRef<number>(0)

  useEffect(() => {
    if (isAnimating) {
      const animate = () => {
        setShuffleSeed(Math.floor(Math.random() * 1000000))
        animationRef.current = requestAnimationFrame(animate)
      }
      animationRef.current = requestAnimationFrame(animate)
    } else if (animationRef.current) {
      cancelAnimationFrame(animationRef.current)
    }
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [isAnimating])

  const solver = new IntraNodeRouteSolver({
    nodeWithPortPoints,
    colorMap: generateColorMapFromNodeWithPortPoints(nodeWithPortPoints),
    hyperParameters: {
      ...hyperParameters,
      SHUFFLE_SEED: shuffleSeed,
    },
  })

  solver.solve()

  const solvedCount = solver.solvedRoutes.length

  useEffect(() => {
    if (solvedCount > maxSolvedRoutes) {
      setMaxSolvedRoutes(solvedCount)
      setBestSeed(shuffleSeed)

      // Stop animation if all connections are solved
      if (solvedCount === solver.totalConnections) {
        setIsAnimating(false)
      }
    }
  }, [solvedCount, shuffleSeed, solver.totalConnections])

  const graphics =
    solver.solvedRoutes.length > 0 ? solver.visualize() : { lines: [] }

  return (
    <div>
      <div className="border p-2 m-2 text-center">
        Max Solved: {maxSolvedRoutes} (Seed: {bestSeed})
      </div>
      <button
        className="border p-2 m-2"
        onClick={() => setShuffleSeed(shuffleSeed + 1)}
      >
        Next Seed
      </button>
      <button
        className="border p-2 m-2"
        onClick={() => setShuffleSeed(Math.floor(Math.random() * 1000))}
      >
        Shuffle (Current Seed: {shuffleSeed})
      </button>
      <button
        className="border p-2 m-2"
        onClick={() => setIsAnimating(!isAnimating)}
      >
        {isAnimating ? "Stop" : "Start"} Animation
      </button>
      <span className="border p-2 m-2 text-center font-bold">
        {solver.solvedRoutes.length} / {solver.totalConnections}
      </span>
      <span className="border p-2 m-2 text-center">
        Iterations: {solver.iterations}
      </span>
      {solver.error && (
        <div className="border p-2 m-2 text-red-500">Error: {solver.error}</div>
      )}
      <InteractiveGraphics
        graphics={
          solver.failedSubSolvers.length > 0
            ? combineVisualizations(
                solver.failedSubSolvers[0].visualize(),
                solver.visualize(),
              )
            : solver.visualize()
        }
      />
      <table className="border-collapse border m-2">
        <thead>
          <tr>
            <th className="border p-2">Hyperparameter</th>
            <th className="border p-2">Value</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries({
            ...hyperParameters,
            SHUFFLE_SEED: shuffleSeed,
          }).map(([key, value]) => (
            <tr key={key}>
              <td className="border p-2">{key}</td>
              <td className="border p-2">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
