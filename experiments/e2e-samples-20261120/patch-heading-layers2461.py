from pathlib import Path
p=Path("node_modules/@tscircuit/fanout-solver/lib/fanout-solver.ts")
s=p.read_text()
start=s.index("function getCandidateEscapeLayersForBus(")
end=s.index("export class FanoutSolver",start)
part=s[start:end]
marker="  const individuallyRoutableLayers = allowedEscapeLayers.filter("
assert part.count(marker)==1
part=part.replace(marker,'  const mayRetryHeading =\n    !bus.requestedDirection &&\n    !bus.preferredExit &&\n    !bus.exitEdge &&\n    !bus.connections.some((connection) => connection.hasExplicitExitTarget)\n  const directions = mayRetryHeading\n    ? [bus.direction, ...(["left", "right", "up", "down"] as const).filter(direction => direction !== bus.direction)]\n    : [bus.direction]\n  const individuallyRoutableLayers = allowedEscapeLayers.filter(')
part=part.replace('    (targetLayer) =>\n      routeBus({','    (targetLayer) =>\n      directions.some(direction => routeBus({')
part=part.replace('        bus,','        bus: direction === bus.direction ? bus : { ...bus, direction },')
part=part.replace('      }) !== null,','      }) !== null),')
p.write_text(s[:start]+part+s[end:])
