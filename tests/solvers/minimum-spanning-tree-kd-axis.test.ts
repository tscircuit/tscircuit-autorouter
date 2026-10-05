import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import { buildMinimumSpanningTree } from "lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"

test("MST neighbour search uses the same split axes as tree construction", async () => {
  // Synthetic Cartesian coordinates in mm; no private board input is used.
  // More than eleven points are needed to exercise candidate pruning.
  const points = [
    { x: 10, y: 14 }, { x: 25, y: 13 }, { x: 15, y: 10 },
    { x: 29, y: 34 }, { x: 15, y: 6 }, { x: 8, y: 22 },
    { x: 22, y: 28 }, { x: 11, y: 19 }, { x: 23, y: 39 },
    { x: 32, y: 21 }, { x: 24, y: 34 }, { x: 22, y: 18 },
    { x: 11, y: 5 }, { x: 38, y: 5 }, { x: 35, y: 36 },
    { x: 31, y: 0 }, { x: 28, y: 26 }, { x: 34, y: 5 },
    { x: 6, y: 6 }, { x: 16, y: 6 }, { x: 7, y: 4 },
    { x: 31, y: 34 },
  ]

  // Independent complete-graph Prim reference. For this fixture the correct
  // ten-neighbour graph contains the exact MST. Reversed-axis pruning does not.
  const visited = new Uint8Array(points.length)
  const nearestDistances = new Float64Array(points.length).fill(Infinity)
  const parents = new Int32Array(points.length).fill(-1)
  const referenceEdges: ReturnType<typeof buildMinimumSpanningTree> = []
  nearestDistances[0] = 0
  let referenceLength = 0

  for (let iteration = 0; iteration < points.length; iteration++) {
    let nearestPointIndex = -1
    for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
      if (
        !visited[pointIndex] &&
        (nearestPointIndex === -1 ||
          nearestDistances[pointIndex] < nearestDistances[nearestPointIndex])
      ) {
        nearestPointIndex = pointIndex
      }
    }
    visited[nearestPointIndex] = 1
    referenceLength += nearestDistances[nearestPointIndex]
    const nearestPoint = points[nearestPointIndex]
    if (parents[nearestPointIndex] !== -1) {
      referenceEdges.push({
        from: points[parents[nearestPointIndex]],
        to: nearestPoint,
        weight: nearestDistances[nearestPointIndex],
      })
    }

    for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
      if (visited[pointIndex]) continue
      const point = points[pointIndex]
      const distance = Math.hypot(
        point.x - nearestPoint.x,
        point.y - nearestPoint.y,
      )
      if (distance < nearestDistances[pointIndex]) {
        nearestDistances[pointIndex] = distance
        parents[pointIndex] = nearestPointIndex
      }
    }
  }

  const edges = buildMinimumSpanningTree(points)
  const actualLength = edges.reduce((length, edge) => length + edge.weight, 0)
  for (const panel of [
    { name: "actual", edges, length: actualLength, color: "blue" },
    { name: "reference", edges: referenceEdges, length: referenceLength, color: "green" },
  ]) {
    const graphics: GraphicsObject = {
      coordinateSystem: "cartesian",
      lines: panel.edges.map((edge) => ({
        points: [edge.from, edge.to],
        strokeColor: panel.color,
      })),
      points: points.map((point, index) => ({
        ...point,
        label: `P${index + 1}`,
        color: "black",
      })),
      texts: [{
        x: 20, y: 45,
        text: `${panel.name}: ${panel.length.toFixed(3)} mm / ${panel.edges.length} edges`,
        fontSize: 1.2,
      }],
    }
    await expect(getSvgFromGraphicsObject(graphics, {
      backgroundColor: "white",
      includeTextLabels: true,
    })).toMatchSvgSnapshot(import.meta.path, { svgName: panel.name })
  }

  expect(edges).toHaveLength(points.length - 1)
  expect(actualLength).toBeCloseTo(referenceLength, 8)
})
