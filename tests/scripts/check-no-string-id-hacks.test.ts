import { expect, test } from "bun:test"
import {
  findStringIdPrefixHacks,
  getAddedProductionLines,
} from "../../scripts/check-no-string-id-hacks"

test("finds hard-coded ID prefixes without flagging ordinary string checks", () => {
  const source = `
const hasSourceTrace = connectionId.startsWith("source_trace_")
const hasPcbTrace = connectionId.startsWith(
  "pcb_trace_",
)
const cacheEntry = key.startsWith(CACHE_PREFIX)
const prose = message.startsWith("Route failed")
// example.startsWith("comment_prefix_")
/*
 * example.startsWith("block_comment_prefix_")
 */
`

  expect(findStringIdPrefixHacks(source)).toEqual([
    { prefix: "source_trace_", startLine: 2, endLine: 2 },
    { prefix: "pcb_trace_", startLine: 3, endLine: 4 },
  ])

  const diff = `diff --git a/lib/example.ts b/lib/example.ts
+++ b/lib/example.ts
@@ -10,0 +11,2 @@
+const safe = true
+const hacked = connectionId.startsWith("source_trace_")
diff --git a/tests/example.test.ts b/tests/example.test.ts
+++ b/tests/example.test.ts
@@ -0,0 +1 @@
+expect(connectionId.startsWith("source_trace_")).toBe(true)
`

  expect(getAddedProductionLines(diff)).toEqual([
    { file: "lib/example.ts", line: 11 },
    { file: "lib/example.ts", line: 12 },
  ])
})
