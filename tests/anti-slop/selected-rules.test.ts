import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { readLintResult, repoRoot } from "./cli-helpers"

test("the real Bun CLI warns on selected patterns and accepts PCB schema code", () => {
  const directory = mkdtempSync(join(repoRoot, "lib/anti-slop-integration-"))
  try {
    writeFileSync(
      join(directory, "bad.ts"),
      `
const chain = { x: 1 } as unknown as { x: number }
const precise = { x: 1 }
const widened: unknown = precise
const narrowed = widened as { x: number }
const objectCopy = [{ x: 1 }].reduce((acc, item) => Object.assign({}, acc, item), {})
const arrayCopy = [1, 2].reduce((acc, item) => acc.concat(item), [] as number[])
const fromCopy = [1, 2].reduce((acc, item) => Array.from(acc), [] as number[])
const spreadCopy = [1, 2].reduce((acc, item) => [...acc, item], [] as number[])
const objectSpreadCopy = [{ x: 1 }].reduce((acc, item) => ({ ...acc, ...item }), {})
`,
    )
    const bad = readLintResult([join(directory, "bad.ts")])
    const counts = new Map<string, number>()
    for (const diagnostic of bad.diagnostics) {
      counts.set(diagnostic.code, (counts.get(diagnostic.code) ?? 0) + 1)
      expect(diagnostic.severity).toBe("warning")
    }
    expect(Object.fromEntries(counts)).toEqual({
      "anti-slop(no-chained-type-assertions)": 1,
      "anti-slop(no-widen-then-assert)": 1,
      "anti-slop(no-reduce-accumulator-copy)": 3,
      "oxc(no-accumulating-spread)": 2,
    })
    expect(bad.number_of_files).toBe(1)
    expect(bad.diagnostics).toHaveLength(7)
    expect(bad.number_of_rules).toBe(4)

    writeFileSync(
      join(directory, "geometry.ts"),
      `
type RectObstacle = { shape: "rect"; center: { x: number; y: number }; width: number; height: number }
type CircleObstacle = { shape: "circle"; center: { x: number; y: number }; radius: number }
type Obstacle = RectObstacle | CircleObstacle
const obstacleShapes: Obstacle[] = [{ shape: "rect", center: { x: 0, y: 0 }, width: 2, height: 1 }]
const shapeSchema = { shape: { rect: true, circle: true } }
const compact = "rect" as const
const constChain = "rect" as const as const
const typed = obstacleShapes[0] as Obstacle
const mapped = obstacleShapes.filter(item => item.shape === "rect").map(item => item.center)
function parseShape(input: unknown): unknown {
  return typeof input === "object" ? input : undefined
}
const points = obstacleShapes.reduce((acc, item) => {
  acc.push({ ...item.center })
  return acc
}, [] as { x: number; y: number }[])
const byShape = obstacleShapes.reduce((acc, item) => {
  Object.assign(acc, { [item.shape]: item })
  return acc
}, {} as Record<string, Obstacle>)
const copiedItems = obstacleShapes.reduce((acc, item) => {
  acc.push(Object.assign({}, item))
  return acc
}, [] as Obstacle[])
const coordinates = [1, 2].reduce((acc, item) => acc + item, 0)
`,
    )
    const geometry = readLintResult([join(directory, "geometry.ts")])
    expect(geometry.number_of_files).toBe(1)
    expect(geometry.diagnostics).toEqual([])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
