import input19 from "./expansion_degrees_bug_bugreport19.json" with {
  type: "json",
}
import input1 from "./expansion_degrees_bug_bugreport1.json" with {
  type: "json",
}
import input16 from "./expansion_degrees_bug_bugreport16.json" with {
  type: "json",
}
import { expect, test } from "bun:test"
import {
  getSvgFromGraphicsObject,
  GraphicsObject,
  mergeGraphics,
  stackGraphicsVertically,
  Text,
} from "graphics-debug"
import {
  MultiSectionPortPointOptimizer,
  type MultiSectionPortPointOptimizerParams,
} from "lib/solvers/MultiSectionPortPointOptimizer"
import type { PortPoint } from "lib/types/high-density-types"

const EXPANSION_DEGREEs = [1, 2, 3, 4, 5, 6]

type SerializedAssignedPortPoint = {
  connectionName: string
  rootConnectionName?: string
}

type SerializedParams = Omit<
  MultiSectionPortPointOptimizerParams,
  "initialAssignedPortPoints" | "initialNodeAssignedPortPoints"
> & {
  initialAssignedPortPoints: Record<string, SerializedAssignedPortPoint>
  initialNodeAssignedPortPoints: Record<string, PortPoint[]>
}

function deserializeParams(
  serialized: SerializedParams,
): MultiSectionPortPointOptimizerParams {
  return {
    ...serialized,
    initialAssignedPortPoints: new Map(
      Object.entries(serialized.initialAssignedPortPoints),
    ),
    initialNodeAssignedPortPoints: new Map(
      Object.entries(serialized.initialNodeAssignedPortPoints) as [
        string,
        PortPoint[],
      ][],
    ),
  }
}

test("expansion degree " +
  EXPANSION_DEGREEs.join(",") +
  "snapshot bugreport19", () => {
  const [serializedParams] = input19 as unknown as SerializedParams[]
  let graphics: GraphicsObject[] = []

  for (const EXPANSION_DEGREE of EXPANSION_DEGREEs) {
    const optimizer = new MultiSectionPortPointOptimizer(
      deserializeParams(serializedParams),
    )

    const originalCreateSection = optimizer.createSection.bind(optimizer)
    optimizer.createSection = (params) =>
      originalCreateSection({
        ...params,
        expansionDegrees: EXPANSION_DEGREE,
      })

    optimizer.solve()
    const rects = optimizer.visualize().rects ?? []
    let maxY = -Infinity
    for (const rect of rects) {
      const top = rect.center.y + rect.height * (2 / 3)
      if (top > maxY) {
        maxY = top
      }
    }
    const text: Text = {
      text: "EXPANSION_DEGREE= " + EXPANSION_DEGREE,
      x: 0,
      y: maxY,
      fontSize: 0.5,
    }
    graphics.push(mergeGraphics(optimizer.visualize(), { texts: [text] }))
  }
  const viz = stackGraphicsVertically(graphics)
  const svg = getSvgFromGraphicsObject(viz, {
    backgroundColor: "white",
  })
  expect(svg).toMatchSvgSnapshot(import.meta.path + "19")
})

test("expansion degree " +
  EXPANSION_DEGREEs.join(",") +
  "snapshot bugreport1", () => {
  const [serializedParams] = input1 as unknown as SerializedParams[]
  const graphics: GraphicsObject[] = []
  for (const EXPANSION_DEGREE of EXPANSION_DEGREEs) {
    const optimizer = new MultiSectionPortPointOptimizer(
      deserializeParams(serializedParams),
    )

    const originalCreateSection = optimizer.createSection.bind(optimizer)
    optimizer.createSection = (params) =>
      originalCreateSection({
        ...params,
        expansionDegrees: EXPANSION_DEGREE,
      })

    optimizer.solve()
    const rects = optimizer.visualize().rects ?? []
    let maxY = -Infinity
    for (const rect of rects) {
      const top = rect.center.y + rect.height * (2 / 3)
      if (top > maxY) {
        maxY = top
      }
    }
    const text: Text = {
      text: "EXPANSION_DEGREE= " + EXPANSION_DEGREE,
      x: 0,
      y: maxY,
      fontSize: 0.5,
    }
    graphics.push(mergeGraphics(optimizer.visualize(), { texts: [text] }))
  }
  const viz = stackGraphicsVertically(graphics)
  const svg = getSvgFromGraphicsObject(viz, {
    backgroundColor: "white",
  })

  expect(svg).toMatchSvgSnapshot(import.meta.path + "1")
})

test("expansion degree " +
  EXPANSION_DEGREEs.join(",") +
  "snapshot bugreport16", () => {
  const [serializedParams] = input16 as unknown as SerializedParams[]
  const graphics: GraphicsObject[] = []
  for (const EXPANSION_DEGREE of EXPANSION_DEGREEs) {
    const optimizer = new MultiSectionPortPointOptimizer(
      deserializeParams(serializedParams),
    )

    const originalCreateSection = optimizer.createSection.bind(optimizer)
    optimizer.createSection = (params) =>
      originalCreateSection({
        ...params,
        expansionDegrees: EXPANSION_DEGREE,
      })

    optimizer.solve()
    const rects = optimizer.visualize().rects ?? []
    let maxY = -Infinity
    for (const rect of rects) {
      const top = rect.center.y + rect.height * (2 / 3)
      if (top > maxY) {
        maxY = top
      }
    }
    const text: Text = {
      text: "EXPANSION_DEGREE= " + EXPANSION_DEGREE,
      x: 0,
      y: maxY,
      fontSize: 0.5,
    }
    graphics.push(mergeGraphics(optimizer.visualize(), { texts: [text] }))
  }
  const viz = stackGraphicsVertically(graphics)
  const svg = getSvgFromGraphicsObject(viz, {
    backgroundColor: "white",
  })

  expect(svg).toMatchSvgSnapshot(import.meta.path + "16")
})
