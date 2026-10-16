import { expect, test } from "bun:test"
import { getPipeline9SharedTerminalViaCandidates } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9SharedTerminalViaCandidates"
import { createSharedTerminalViaRoutes } from "tests/fixtures/shared-terminal-via-routes"

test("coincident endpoints on different ports do not authorize sharing a via", (): void => {
  const routes = createSharedTerminalViaRoutes()
  routes[1]!.route.at(-1)!.pcb_port_id = "different-port"

  expect([...getPipeline9SharedTerminalViaCandidates(routes)]).toHaveLength(0)
})
