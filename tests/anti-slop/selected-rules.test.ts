import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { readLintResult, repoRoot } from "./cli-helpers"

const genericRules = [
  "no-array-filter-map",
  "no-reduce-accumulator-copy",
  "no-chained-type-assertions",
  "no-conditional-empty-object-spread",
  "no-known-value-widening",
  "no-module-mocking",
  "no-object-parameters",
  "no-reflect-apply",
  "no-reflect-get",
  "no-runtime-typeof",
  "no-unsafe-dictionary-type",
  "no-shape-in-symbol-names",
  "no-unknown-parameters",
  "no-unknown-returns",
  "no-unknown-type-aliases",
  "no-widen-then-assert",
  "require-readable-spacing",
  "require-safety-comment-for-type-assertion",
]

const effectRules = [
  "no-manual-effect-error-tag",
  "no-manual-tag-comparison",
  "no-manual-tagged-construction",
  "no-service-constructor-imports",
  "prefer-effect-match",
]

test("the Bun CLI enforces every pinned rule at error severity and preserves schema exceptions", () => {
  const directory = mkdtempSync(join(repoRoot, "lib/anti-slop-integration-"))
  try {
    writeFileSync(
      join(directory, "bad.ts"),
      `
import { makeService } from "./owner"
const values: number[] = [1, 2]
const chained = values as unknown as string[]
const precise = { x: 1 }
const widened: unknown = precise
const narrowed = widened as { x: number }
const copied = values.reduce((acc, item) => acc.concat(item), [] as number[])
const spreadCopy = values.reduce((acc, item) => [...acc, item], [] as number[])
const passes = values.filter(item => item > 0).map(item => item + 1)
const conditional = { ...(enabled ? { x: 1 } : {}) }
const broad: Record<string, () => void> = { go: () => {} }
const schemaShape = { x: 1 }
type UnknownAlias = unknown
type Dictionary = Record<string, unknown>
function parse(input: unknown): unknown { return input }
function save(input: object): object { return input }
if (typeof payload === "string") console.log(payload)
vi.mock("./owner")
Reflect.get(owner, "value")
Reflect.apply(operation, owner, [])
const tagged = { _tag: "Ready" }
if (tagged._tag === "Ready") console.log(tagged)
Effect.catch(error => error._tag === "Missing" ? recover : Effect.fail(error))
const label = state === "one" ? "1" : state === "two" ? "2" : "3"
`,
    )
    const bad = readLintResult([join(directory, "bad.ts")], 1)
    const reported = new Set(
      bad.diagnostics.map((diagnostic) => diagnostic.code),
    )
    const expected = [
      ...genericRules.map((rule) => `anti-slop(${rule})`),
      ...effectRules.map((rule) => `anti-slop-effect(${rule})`),
      "oxc(no-accumulating-spread)",
    ]
    expect([...reported].sort()).toEqual(expected.sort())
    expect(bad.number_of_rules).toBe(24)
    expect(bad.number_of_files).toBe(1)
    for (const diagnostic of bad.diagnostics) {
      expect(diagnostic.severity).toBe("error")
    }

    writeFileSync(
      join(directory, "geometry.ts"),
      `
type RectObstacle = {
  // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- Public PCB schema discriminant.
  shape: "rect"
  center: { x: number; y: number }
  width: number
  height: number
}

const obstacles: RectObstacle[] = []

const points = obstacles.reduce((acc, item) => {
  acc.push({ ...item.center })

  return acc
}, [])

const compact = "rect" as const

const constChain = "rect" as const as const

const pair = [1, 2]
// oxlint-disable-next-line anti-slop/require-readable-spacing -- Biome keeps this leading ASI guard attached to the preceding statement.
;[pair[0], pair[1]] = [pair[1], pair[0]]
`,
    )
    const geometry = readLintResult([join(directory, "geometry.ts")])
    expect(geometry.number_of_files).toBe(1)
    expect(geometry.diagnostics).toEqual([])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
