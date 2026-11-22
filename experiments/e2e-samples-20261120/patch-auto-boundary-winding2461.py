from pathlib import Path
p=Path("node_modules/@tscircuit/fanout-solver/lib/prepare-buses.ts")
s=p.read_text()
start=s.index("function resolveBusDirection(")
end=s.index("\nexport ",start)
part=s[start:end]
marker='}): { direction: FanoutDirection; preferredExit?: FanoutBorderTarget } {'
assert part.count(marker)==1
part=part.replace(marker,'}): { direction: FanoutDirection; preferredExit?: FanoutBorderTarget; exitEdge?: FanoutEdge } {')
marker='      if (directions.length === 1) return { direction: directions[0]! }'
assert part.count(marker)==1
part=part.replace(marker,'      if (directions.length === 1) {\n        const direction = directions[0]!\n        for (const connection of connections) {\n          const target = connection.exitTargetPoint ?? connection.targetPoint\n          const targetLayer = "layer" in connection.targetPoint ? connection.targetPoint.layer : undefined\n          if (typeof targetLayer !== "string") continue\n          connection.exitTargetPoint = { x: target.x, y: target.y, layer: targetLayer }\n          connection.hasExplicitLayeredExitTarget = true\n        }\n        const exitEdge = ({left:"left",right:"right",up:"top",down:"bottom"} as const)[direction]\n        return { direction, exitEdge }\n      }')
s=s[:start]+part+s[end:]
marker='      ...(busSpec.exitEdge ? { exitEdge: busSpec.exitEdge } : {}),'
assert s.count(marker)==1
s=s.replace(marker,'      ...((busSpec.exitEdge ?? resolvedExit.exitEdge) ? {exitEdge: busSpec.exitEdge ?? resolvedExit.exitEdge} : {}),')
p.write_text(s)
