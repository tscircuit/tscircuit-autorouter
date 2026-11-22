from pathlib import Path
p=Path('node_modules/@tscircuit/fanout-solver/lib/route-bus/route-analytic-boundary-alternatives.ts')
s=p.read_text()
marker='  searchConnectionOrders(context)\n  const sourceTrackIsGuided ='
assert s.count(marker)==1
s=s.replace(marker,'  const sourceTrackIsGuided =')
marker='    busUsesCoordinatedWindingChannel(context.bus)\n'
assert s.count(marker)==1
s=s.replace(marker,marker+'  const preferSourceTracks =\n    !context.targetUsesVia &&\n    context.bus.connections.length === 1 &&\n    !sourceTrackIsGuided &&\n    !context.fixedBoundaryTracksByConnectionIndex &&\n    context.bus.connections.every(connection => !connection.hasExplicitExitTarget)\n  searchConnectionOrders(context, { preferSourceTracks })\n')
p.write_text(s)
s=p.read_text()
marker='  const preferredTracks = [\n    ...sourceAlignedTracks,'
assert s.count(marker)==1
s=s.replace(marker,'  const preferStraightSourceEscape =\n    preferSourceTracks && !targetUsesVia && bus.connections.length === 1\n  const directSourceTracks = preferStraightSourceEscape\n    ? sourceAlignedTracks.map((value) => ({ value, kind: "preferred" as const }))\n    : []\n  const preferredTracks = [\n    ...(preferStraightSourceEscape ? [] : sourceAlignedTracks),')
start=s.index('  const trackCandidates = preferredTracks\n');end=s.index('  for (let trackIndex',start)
block=s[start:end];flat,filter_part=block.split('    .filter(',1)
flat=flat.replace('  const trackCandidates = preferredTracks\n    .flatMap(', '    ...preferredTracks.flatMap(',1)
replacement='  const trackCandidates = [\n    ...directSourceTracks,\n'+flat.rstrip()+',\n  ]\n    .filter('+filter_part
s=s[:start]+replacement+s[end:];p.write_text(s)
