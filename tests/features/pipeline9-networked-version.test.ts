import { expect, test } from "bun:test"
import { AUTOROUTER_VERSION } from "lib"
import packageJson from "../../package.json" with { type: "json" }

test("Pipeline9 network cache version matches the package version", () => {
  expect(AUTOROUTER_VERSION).toBe(packageJson.version)
  expect(packageJson.scripts.prepack).toBe("bun run build")
})
