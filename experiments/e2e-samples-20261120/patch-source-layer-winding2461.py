from pathlib import Path
root=Path('node_modules/@tscircuit/fanout-solver/lib/route-bus')
p=root/'route-singleton-boundary-steps.ts';s=p.read_text()
s=s.replace('import { getDirectionForExitEdge }', 'import { getDirectionForExitEdge, getExitEdgeForDirection }')
marker='  // A fixed source escape is also useful'
assert s.count(marker)==1
s=s.replace(marker,'''  const connection = bus.connections[0]
  const sourceLayerRouting =
    bus.connections.length === 1 &&
    targetLayer === connection?.sourceLayer &&
    !fixedViaPointsByConnectionIndex &&
    !context.sourceEscapePaths &&
    !context.viaMinimalOnly
  const exitEdge = bus.exitEdge ??
    (sourceLayerRouting ? getExitEdgeForDirection(bus.direction) : undefined)
'''+marker)
s=s.replace('    bus.exitEdge &&','    exitEdge &&')
marker='''    bus.connections[0]!.sourceLayer !== targetLayer &&
    fixedViaPointsByConnectionIndex &&
    context.sourceEscapePaths?.has(bus.connections[0]!.connectionIndex)'''
assert s.count(marker)==1
s=s.replace(marker,'''    (sourceLayerRouting ||
      (bus.connections[0]!.sourceLayer !== targetLayer &&
        fixedViaPointsByConnectionIndex &&
        context.sourceEscapePaths?.has(bus.connections[0]!.connectionIndex)))''')
s=s.replace('    const boundaryDirection = getDirectionForExitEdge(bus.exitEdge)','    const windingBus = { ...bus, exitEdge }\n    const boundaryDirection = getDirectionForExitEdge(exitEdge)')
s=s.replace('        bus,','        bus: windingBus,')
marker='''            viaPoint: fixedViaPointsByConnectionIndex.get(
              connection.connectionIndex,
            )!,'''
assert s.count(marker)==1
s=s.replace(marker,'''            viaPoint: sourceLayerRouting
              ? connection.sourcePoint
              : fixedViaPointsByConnectionIndex!.get(connection.connectionIndex)!,''')
s=s.replace('axis: getExitAxis(bus, boundaryDirection)','axis: getExitAxis(windingBus, boundaryDirection)')
s=s.replace('        maximumRouteOrderAttempts: 3,','        maximumRouteOrderAttempts: 3,\n        allowSourceLayerRouting: sourceLayerRouting,')
p.write_text(s)
p=root/'route-bus-alternatives-steps.ts';s=p.read_text()
marker='  if (yield* routeSingletonBoundarySteps(context)) return context.alternatives'
assert s.count(marker)==1
s=s.replace(marker,'  if (context.targetUsesVia && (yield* routeSingletonBoundarySteps(context))) return context.alternatives')
marker='  routeAnalyticBoundaryAlternatives(context)\n  return context.alternatives'
assert s.count(marker)==1
s=s.replace(marker,'''  routeAnalyticBoundaryAlternatives(context)
  if (context.alternatives.length === 0 && !context.targetUsesVia)
    yield* routeSingletonBoundarySteps(context)
  return context.alternatives''')
p.write_text(s)
