import { InteractiveGraphics } from "graphics-debug/react"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { combineVisualizations } from "lib/utils/combineVisualizations"
import { generateColorMapFromNodeWithPortPoints } from "lib/utils/generateColorMapFromNodeWithPortPoints"
import { useState, useRef, useEffect } from "react"

const { nodeWithPortPoints } = {
  nodeWithPortPoints: {
    capacityMeshNodeId: "cn555",
    portPoints: [
      {
        x: -27.436342032812494,
        y: 27.208403793750012,
        z: 0,
        connectionName: "source_trace_17",
      },
      {
        x: -25.897046703124992,
        y: 27.208403793750012,
        z: 0,
        connectionName: "source_trace_26",
      },
      {
        x: -24.35775137343749,
        y: 27.208403793750012,
        z: 0,
        connectionName: "source_trace_8",
      },
      {
        x: -28.975637362499995,
        y: 28.08800112500001,
        z: 0,
        connectionName: "source_trace_1",
      },
      {
        x: -28.975637362499995,
        y: 28.96759845625001,
        z: 0,
        connectionName: "source_trace_10",
      },
      {
        x: -28.975637362499995,
        y: 29.84719578750001,
        z: 0,
        connectionName: "source_trace_13",
      },
      {
        x: -28.975637362499995,
        y: 30.72679311875001,
        z: 0,
        connectionName: "source_trace_16",
      },
      {
        x: -28.975637362499995,
        y: 31.606390450000013,
        z: 0,
        connectionName: "source_trace_4",
      },
      {
        x: -28.975637362499995,
        y: 32.48598778125001,
        z: 0,
        connectionName: "source_trace_7",
      },
      {
        x: -22.818456043749993,
        y: 27.824121925625008,
        z: 0,
        connectionName: "source_trace_1",
      },
      {
        x: -22.818456043749993,
        y: 28.43984005750001,
        z: 0,
        connectionName: "source_trace_10",
      },
      {
        x: -22.818456043749993,
        y: 29.05555818937501,
        z: 0,
        connectionName: "source_trace_13",
      },
      {
        x: -22.818456043749993,
        y: 29.671276321250012,
        z: 0,
        connectionName: "source_trace_16",
      },
      {
        x: -22.818456043749993,
        y: 30.28699445312501,
        z: 0,
        connectionName: "source_trace_17",
      },
      {
        x: -22.818456043749993,
        y: 30.90271258500001,
        z: 0,
        connectionName: "source_trace_26",
      },
      {
        x: -22.818456043749993,
        y: 31.518430716875013,
        z: 0,
        connectionName: "source_trace_4",
      },
      {
        x: -22.818456043749993,
        y: 32.134148848750016,
        z: 0,
        connectionName: "source_trace_7",
      },
      {
        x: -22.818456043749993,
        y: 32.749866980625015,
        z: 0,
        connectionName: "source_trace_8",
      },
    ],
    center: { x: -25.897046703124992, y: 30.28699445312501 },
    width: 6.157181318750002,
    height: 6.157181318750002,
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
      FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR: 20,
      FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR: 100,
      FUTURE_CONNECTION_PROXIMITY_VD: 10,
      MISALIGNED_DIST_PENALTY_FACTOR: 10,
      VIA_PENALTY_FACTOR_2: 2,
      FLIP_TRACE_ALIGNMENT_DIRECTION: true,
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
