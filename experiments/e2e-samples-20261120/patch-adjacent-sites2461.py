from pathlib import Path
p=Path("node_modules/@tscircuit/fanout-solver/lib/route-bus/route-analytic-boundary-alternatives.ts")
s=p.read_text()
s='import { getComponentDogboneViaSiteCandidates } from "../match-component-dogbone-via-sites"\n'+s
s=s.replace('{ startAtSource = false }: { startAtSource?: boolean } = {},','{ startAtSource = false, initialViaPoint }: { startAtSource?: boolean; initialViaPoint?: {x:number;y:number} } = {},')
s=s.replace('          startAtSource,','          startAtSource,\n          initialViaPoint,',1)
s=s.replace('    startAtSource = false,','    startAtSource = false,\n    initialViaPoint,')
s=s.replace('    startAtSource?: boolean','    initialViaPoint?: {x:number;y:number}\n    startAtSource?: boolean')
s=s.replace('        startAtSource,\n      },','        startAtSource,\n        initialViaPoint,\n      },')
s=s.replace('`${startAtSource}', '`${startAtSource}')
s=s.replace('`boundary:${startAtSource}:','`boundary:${initialViaPoint?.x}:${initialViaPoint?.y}:${startAtSource}:')
s=s.replace('        : undefined,','        : initialViaPoint,')
marker='  if (\n    context.alternatives.length > 0 ||'
insert='  if (context.alternatives.length === 0 && context.targetUsesVia && !sourceTrackIsGuided && context.bus.connections.length === 1) {\n    const sites = getComponentDogboneViaSiteCandidates([context.bus], {\n      viaDiameter: context.viaDiameter,\n      viaHoleDiameter: context.viaHoleDiameter,\n      traceWidth: context.traceWidth,\n      clearance: context.clearance,\n      additionalObstacles: context.srj.obstacles,\n    })\n    for (const site of sites) {\n      searchConnectionOrders(context, { initialViaPoint: site.point })\n      if (context.alternatives.length >= context.maxAlternatives) break\n    }\n  }\n'
assert s.count(marker)==1
s=s.replace(marker,insert+marker)
p.write_text(s)
