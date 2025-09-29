import { InteractiveGraphics } from "graphics-debug/react"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { combineVisualizations } from "lib/utils/combineVisualizations"
import { generateColorMapFromNodeWithPortPoints } from "lib/utils/generateColorMapFromNodeWithPortPoints"
import { useState, useRef, useEffect } from "react"

const { nodeWithPortPoints } = {
  nodeWithPortPoints: {
    capacityMeshNodeId: "cn1047",
    portPoints: [
      {
        x: -0.5059869499999792,
        y: 2.65625,
        connectionName: "source_trace_35",
        z: 0,
      },
      {
        x: -0.5059869499999792,
        y: 0.078125,
        connectionName: "source_trace_35",
        z: 0,
      },
      {
        x: 0.7830755500000208,
        y: 1.3671875,
        connectionName: "source_trace_20",
        z: 0,
      },
      {
        x: -1.7950494499999792,
        y: 1.3671875,
        connectionName: "source_trace_20",
        z: 0,
      },
    ],
    center: { x: -0.5059869499999792, y: 1.3671875 },
    width: 2.578125,
    height: 2.578125,
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
      FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR: 0,
      // FUTURE_CONNECTION_PROXIMITY_VD: 50,
      VIA_PENALTY_FACTOR_2: 0,
      FLIP_TRACE_ALIGNMENT_DIRECTION: false,
      MISALIGNED_DIST_PENALTY_FACTOR: 0,
      CELL_SIZE_FACTOR: 0.25,
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
