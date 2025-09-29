import { InteractiveGraphics } from "graphics-debug/react"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { combineVisualizations } from "lib/utils/combineVisualizations"
import { generateColorMapFromNodeWithPortPoints } from "lib/utils/generateColorMapFromNodeWithPortPoints"
import { useState, useRef, useEffect } from "react"

const { nodeWithPortPoints } = {
  nodeWithPortPoints: {
    capacityMeshNodeId: "cn1092",
    portPoints: [
      { x: -15.859375, y: 3.59375, connectionName: "source_trace_22", z: 0 },
      { x: -14.0625, y: 5.390625, connectionName: "source_trace_1", z: 0 },
      {
        x: -16.458333333333332,
        y: 7.1875,
        connectionName: "source_trace_1",
        z: 0,
      },
      {
        x: -15.260416666666668,
        y: 7.1875,
        connectionName: "source_trace_22",
        z: 0,
      },
    ],
    center: { x: -15.859375, y: 5.390625 },
    width: 3.59375,
    height: 3.59375,
  },
}

export default () => {
  const [shuffleSeed, setShuffleSeed] = useState(10)
  const [isAnimating, setIsAnimating] = useState(false)
  const [maxSolvedRoutes, setMaxSolvedRoutes] = useState(0)
  const [bestSeed, setBestSeed] = useState(10)
  const animationRef = useRef<number | undefined>(undefined)

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
      // FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR: 20,
      // FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR: 20,
      // FUTURE_CONNECTION_PROXIMITY_VD: 50,
      FLIP_TRACE_ALIGNMENT_DIRECTION: false,
      // MISALIGNED_DIST_PENALTY_FACTOR: 3,
      CELL_SIZE_FACTOR: 1,
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

  if (solver.failedSubSolvers.length > 0) {
    return (
      <div>
        <div className="border p-2 m-2 text-center font-bold">
          {solver.solvedRoutes.length} / {solver.totalConnections}
        </div>
        <div className="border p-2 m-2 text-center">
          Max Solved: {maxSolvedRoutes} (Seed: {bestSeed})
        </div>
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
        <InteractiveGraphics
          graphics={combineVisualizations(
            solver.failedSubSolvers[0].visualize(),
            solver.visualize(),
          )}
        />
      </div>
    )
  }

  return (
    <div>
      <div className="border p-2 m-2 text-center">
        Max Solved: {maxSolvedRoutes} (Seed: {bestSeed})
      </div>
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
      <InteractiveGraphics graphics={graphics} />
    </div>
  )
}
