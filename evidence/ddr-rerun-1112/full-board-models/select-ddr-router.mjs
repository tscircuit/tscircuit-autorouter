// Preload in the original DDR worker, selecting the same router as the full boards.
if (!process.env.FULL_BOARD_CORE_SOURCE || !process.env.FULL_BOARD_ROUTER_MODULE) {
  throw new Error("DDR comparison requires explicit core and router sources")
}
const { SOLVERS } = await import(`${process.env.FULL_BOARD_CORE_SOURCE}/index.ts`)
const { AutoroutingPipelineSolver9_PreloadedTraceGraph } = await import(process.env.FULL_BOARD_ROUTER_MODULE)
Object.assign(SOLVERS, { AutoroutingPipelineSolver9_PreloadedTraceGraph })
