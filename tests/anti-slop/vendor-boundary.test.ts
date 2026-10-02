import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { repoRoot } from "./cli-helpers"

test("reviewed vendor bytes and attribution are retained without upstream test discovery", () => {
  const directory = join(repoRoot, "tools/oxlint/anti-slop")
  const manifest = JSON.parse(
    readFileSync(join(directory, "SOURCE-SHA256.json"), "utf8"),
  ) as Record<string, string>
  const files = readdirSync(directory, { recursive: true, withFileTypes: true })
  expect(
    files.filter((file) => file.isFile() && /\.(test|spec)\./.test(file.name)),
  ).toEqual([])
  for (const [path, expected] of Object.entries(manifest)) {
    const hash = createHash("sha256")
      .update(readFileSync(join(directory, path), "utf8"))
      .digest("hex")
    expect(hash).toBe(expected)
  }
  expect(readFileSync(join(directory, "LICENSE"), "utf8")).toContain(
    "2026 Dillon Mulroy",
  )
  const nestedLicense = readFileSync(
    join(directory, "vendor/eslint-stylistic/LICENSE"),
    "utf8",
  )
  expect(nestedLicense).toContain("OpenJS Foundation")
  expect(nestedLicense).toContain("ESLint Stylistic contributors")
  expect(
    readFileSync(
      join(directory, "vendor/eslint-stylistic/UPSTREAM.md"),
      "utf8",
    ),
  ).toContain("435c3ea0fd26a5fef9042c4b36b6e165fbbf8d08")
  const packages = ["oxlint", "@oxlint/plugins"]
  for (const name of packages) {
    const installed = JSON.parse(
      readFileSync(
        join(repoRoot, "node_modules", name, "package.json"),
        "utf8",
      ),
    )
    expect(installed.version).toBe("1.86.0")
  }
})
