import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { useState } from "react"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

type LayerName = "top" | "bottom"

type GridPoint =
  | readonly [x: number, y: number]
  | readonly [x: number, y: number, layer: LayerName]

type GridRect = {
  from: GridPoint
  to: GridPoint
}

type GridRoute = {
  points: GridPoint[]
}

const layerToZ: Record<LayerName, number> = {
  top: 0,
  bottom: 1,
}

const getLayer = (point: GridPoint): LayerName => point[2] ?? "top"

const createGridStitchProblem = ({
  connectionName,
  start,
  end,
  boxes,
  routes,
  pitch = 0.5,
  traceThickness = 0.15,
  viaDiameter = 0.6,
}: {
  connectionName: string
  start: GridPoint
  end: GridPoint
  boxes: GridRect[]
  routes: GridRoute[]
  pitch?: number
  traceThickness?: number
  viaDiameter?: number
}): ConstructorParameters<typeof SingleHighDensityRouteStitchSolver3>[0] => {
  const allPoints: GridPoint[] = [
    start,
    end,
    ...boxes.flatMap((box) => [box.from, box.to]),
    ...routes.flatMap((route) => route.points),
  ]

  const rawMinX = Math.min(...allPoints.map((point) => point[0]))
  const rawMaxX = Math.max(...allPoints.map((point) => point[0]))
  const rawMinY = Math.min(...allPoints.map((point) => point[1]))
  const rawMaxY = Math.max(...allPoints.map((point) => point[1]))
  const gridCenter = {
    x: (rawMinX + rawMaxX) / 2,
    y: (rawMinY + rawMaxY) / 2,
  }

  const toWorldPoint = (point: GridPoint) => ({
    x: (point[0] - gridCenter.x) * pitch,
    y: (gridCenter.y - point[1]) * pitch,
    z: layerToZ[getLayer(point)],
  })

  return {
    connectionName,
    start: toWorldPoint(start),
    end: toWorldPoint(end),
    colorMap: {
      [connectionName]: "#16a34a",
    },
    defaultTraceThickness: traceThickness,
    defaultViaDiameter: viaDiameter,
    hdRoutes: routes.map(
      (route): HighDensityIntraNodeRoute => ({
        connectionName,
        route: route.points.map(toWorldPoint),
        traceThickness,
        viaDiameter,
        vias: [],
      }),
    ),
  }
}

const problem = createGridStitchProblem({
  connectionName: "conn1",
  start: [0, 2],
  end: [7, 9],
  boxes: [
    { from: [0, 0], to: [4, 4] },
    { from: [5, 0], to: [9, 4] },
    { from: [5, 5], to: [9, 9] },
  ],
  routes: [
    {
      points: [
        [0, 2],
        [4, 2],
        [5, 2],
      ],
    },
    {
      points: [
        [5, 2],
        [7, 0],
        [9, 3],
        [7, 5],
      ],
    },
    {
      points: [
        [7, 5],
        [7, 7],
        [7, 9],
      ],
    },
  ],
})

const branchingProblem = createGridStitchProblem({
  connectionName: "conn1",
  start: [0, 2],
  end: [13, 2],
  boxes: [
    { from: [0, 0], to: [4, 4] },
    { from: [4.5, 0], to: [8.5, 4] },
    { from: [9, 0], to: [13, 4] },
    { from: [4.5, 5], to: [8.5, 9] },
  ],
  routes: [
    {
      points: [
        [0, 2],
        [4.5, 2],
      ],
    },
    {
      points: [
        [4.5, 2],
        [8.5, 2],
        [13, 2],
      ],
    },
    {
      points: [
        [4.5, 2],
        [6.5, 5],
        [6.5, 9],
      ],
    },
  ],
})

const stitchProblems = [
  {
    name: "Three Island Chain",
    problem,
  },
  {
    name: "Branching Route",
    problem: branchingProblem,
  },
] as const

const ProblemSelector = () => {
  const [selectedProblemName, setSelectedProblemName] = useState<string>(
    stitchProblems[0].name,
  )

  const selectedProblem =
    stitchProblems.find(
      (stitchProblem) => stitchProblem.name === selectedProblemName,
    ) ?? stitchProblems[0]

  return (
    <div style={{ display: "grid", gap: 12, height: "100%" }}>
      <label
        style={{
          alignItems: "center",
          display: "flex",
          gap: 8,
          fontFamily: "sans-serif",
          fontSize: 14,
        }}
      >
        Problem
        <select
          value={selectedProblem.name}
          onChange={(event) =>
            setSelectedProblemName(event.currentTarget.value)
          }
        >
          {stitchProblems.map((stitchProblem) => (
            <option key={stitchProblem.name} value={stitchProblem.name}>
              {stitchProblem.name}
            </option>
          ))}
        </select>
      </label>
      <GenericSolverDebugger
        key={selectedProblem.name}
        solver={
          new SingleHighDensityRouteStitchSolver3(
            selectedProblem.problem,
          ) as any
        }
      />
    </div>
  )
}

export const main = () => {
  return <ProblemSelector />
}

export default main
