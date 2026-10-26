import { test } from "bun:test"
import fixture from "./fixtures/sample24-stitch-terminal-path-net327.json"
import { assertOriginalTerminalContacts } from "./assertOriginalTerminalContacts"

test("sample24 net327 retains the full path to its original top pad", (): void => {
  assertOriginalTerminalContacts(fixture as Parameters<typeof assertOriginalTerminalContacts>[0])
})
