from pathlib import Path
root=Path('node_modules/@tscircuit/fanout-solver/lib')
p=root/'route-bus/types.ts';s=p.read_text();start=s.index('export interface RouteBusParams');tail=s[start:];marker='  srj: SimpleRouteJson\n';assert tail.count(marker)>=1;tail=tail.replace(marker,marker+'  /** Prefer source-aligned handoffs for automatically positioned exits. */\n  preferSourceTracks?: boolean\n',1);p.write_text(s[:start]+tail)
p=root/'route-bus/route-analytic-boundary-alternatives.ts';s=p.read_text();marker='  searchConnectionOrders(context)\n  const sourceTrackIsGuided =';assert s.count(marker)==1;s=s.replace(marker,'  const sourceTrackIsGuided =');marker='    busUsesCoordinatedWindingChannel(context.bus)\n';assert s.count(marker)==1;s=s.replace(marker,marker+'''  const preferSourceTracks =
    context.preferSourceTracks === true &&
    !sourceTrackIsGuided &&
    !context.fixedBoundaryTracksByConnectionIndex &&
    context.bus.connections.every(connection => !connection.hasExplicitExitTarget)
  searchConnectionOrders(context, { preferSourceTracks })
''')
start=s.index('  const trackCandidates = preferredTracks\n');end=s.index('  for (let trackIndex',start);block=s[start:end];flat,filter_part=block.split('    .filter(',1);flat=flat.replace('  const trackCandidates = preferredTracks\n    .flatMap(', '    ...preferredTracks.flatMap(',1)
replacement='''  const exactPreferredTracks = context.preferSourceTracks && preferSourceTracks
    ? preferredTracks.map((value) => ({ value, kind: "preferred" as const }))
    : []
  const trackCandidates = [
    ...exactPreferredTracks,
'''+flat.rstrip()+''',
  ]
    .filter('''+filter_part;s=s[:start]+replacement+s[end:]
s=s.replace('`boundary:${startAtSource}:${preferSourceTracks}:','`boundary:${startAtSource}:${preferSourceTracks}:${context.preferSourceTracks ?? false}:');p.write_text(s)
p=root/'fanout-solver.ts';s=p.read_text()
start=s.index('    let routingPrefixKey = `${routingStrategy}|`');end=s.index('      let busPlans = routeBus(routeParams)',start);part=s[start:end]
marker='        compactBusTracks: this.config.compactBusTracks,\n';assert part.count(marker)==1
part=part.replace(marker,marker+'        preferSourceTracks: routingStrategy === "group-by-layer",\n')
s=s[:start]+part+s[end:];p.write_text(s)
