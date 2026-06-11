# Handoff: Aquinas

Latest findings:
- The active pipeline 7 path uses `TinyHypergraphPortPointPathingSolver`, not the legacy HG solver.
- The narrowest library boundary is `TinyHyperGraphSectionPipelineWithTerminalNetIds.loadHyperGraph(...)`, but the biggest JS-side allocation risk is before that boundary in the wrapper constructor.
- The heaviest construction points are `buildHyperGraph(...)`, `buildSerializedTinyGraph(...)`, duplicate-port prepass output materialization, and `buildInputNodesWithPortPoints(...)`.
- The duplicate-port prepass is the most suspicious stage because it can create another graph-sized transformed copy before the main tiny-hypergraph pipeline starts.

References:
- [lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph.ts](/home/ohmx/Documents/tscircuit-autorouter/lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph.ts:413)
- [lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/buildHyperGraph.ts](/home/ohmx/Documents/tscircuit-autorouter/lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/buildHyperGraph.ts:166)
- [lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver.ts](/home/ohmx/Documents/tscircuit-autorouter/lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver.ts:261)
- [lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver.ts](/home/ohmx/Documents/tscircuit-autorouter/lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver.ts:596)
- [lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver.ts](/home/ohmx/Documents/tscircuit-autorouter/lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver.ts:746)
