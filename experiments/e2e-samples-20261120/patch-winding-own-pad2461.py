from pathlib import Path
p=Path('node_modules/@tscircuit/fanout-solver/lib/route-via-minimal-winding.ts')
s=p.read_text();marker='        obstacle.connectedTo.includes(connectionName) ||';assert s.count(marker)==1
p.write_text(s.replace(marker,'        obstacle === terminal.connection.sourceObstacle ||\n'+marker))
s=p.read_text()
marker="""  const segments = [
    ...(hasSourceDogbone ? sourceSegments : []),
    ...targetSegments,
  ]"""
assert s.count(marker)==1
s=s.replace(marker,marker+"\n  const sourceEscapeSegmentCount = changesLayer\n    ? sourceSegments.length\n    : segments.length")
marker="""    ...(sourceSegments.length > 1
      ? { sourceEscapeSegmentCount: sourceSegments.length }
      : {}),"""
assert s.count(marker)==1
s=s.replace(marker,"    ...(sourceEscapeSegmentCount > 1 ? { sourceEscapeSegmentCount } : {}),")
p.write_text(s)
