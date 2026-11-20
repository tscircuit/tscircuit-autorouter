from pathlib import Path
from collections import Counter
import csv
import gzip
import hashlib
import json
import sys

baseline_root = Path('/workspace/work/rerun-3257/blacksmith-repeat/extracted')
repeat_root = Path('/workspace/work/rerun-3257/blacksmith/extracted')
fixed_root = Path(sys.argv[1])
output_root = Path(__file__).resolve().parent
baseline = {row['board']: row for row in json.loads((baseline_root / 'matrix.json').read_text())}
fixed = {row['board']: row for row in json.loads((fixed_root / 'matrix.json').read_text())}
repeated = {row['board']: row for row in json.loads((repeat_root / 'matrix.json').read_text())}
records = []
for board, before in baseline.items():
    after = fixed[board]
    captures = []
    for root, variant, result in [(baseline_root, 'main', before), (fixed_root, 'regional-terminal-fix', after)]:
        folder = root / variant / board
        events = [json.loads(line) for line in (folder / 'events.jsonl').read_text().splitlines()]
        stages = [event for event in events if event['key'] in ['pipeline-stage', 'start', 'fanout-progress', 'fanout']]
        last = stages[-1]
        phase = last.get('phase', '')
        stage = 'fanout' if last['key'].startswith('fanout') else 'bus lanes' if last['key'] == 'start' else 'graph routing' if phase == 'portPointPathingSolver' else 'detailed routing' if phase == 'highDensityRouteSolver' else phase
        circuit = json.loads(gzip.decompress((folder / 'circuit.json.gz').read_bytes())) if (folder / 'circuit.json.gz').exists() else None
        copper = [element for element in circuit if element['type'] in ['pcb_trace', 'pcb_via']] if circuit is not None else None
        routing_errors = [element['message'] for element in circuit if element['type'] == 'pcb_autorouting_error'] if circuit is not None else []
        fanout_events = [event for event in events if event['key'] in ['fanout-progress', 'fanout']]
        fanout_inputs = sorted(folder.glob('fanout-*-input.json.gz'), key=lambda path: int(path.name.split('-')[1]))
        fanout_progress = None
        if fanout_events and fanout_inputs:
            last_fanout = fanout_events[-1]
            fanout_input = json.loads(gzip.decompress(fanout_inputs[-1].read_bytes()))
            fanout_progress = {'bestPlans': last_fanout.get('best'), 'requests': len(fanout_input[0]['connections']), 'iterations': last_fanout['iterations'], 'attempts': last_fanout['attempts']}
        captures.append({'stage': stage, 'result': result, 'routingErrors': routing_errors, 'fanoutProgress': fanout_progress, 'copper': copper})
    left, right = captures
    records.append({'board': board, 'before': {key: item for key, item in left.items() if key != 'copper'}, 'after': {key: item for key, item in right.items() if key != 'copper'}, 'emittedCopperIdentical': left['copper'] == right['copper'] if left['copper'] is not None and right['copper'] is not None else None})

summary = {
    'versions': json.loads((fixed_root / 'runtime-versions.json').read_text()),
    'fixProvenance': json.loads((fixed_root / 'fix-provenance.json').read_text()),
    'entrypoints': 19,
    'execution': 'Original TSX via RootCircuit.renderUntilSettled, geometryOnly=false; default fanout, bus lanes and autorouter; 600 seconds per board on Blacksmith 32-vCPU ARM',
    'baselineRun': 44824778889,
    'repeatBaselineRun': 44820365588,
    'fixedRun': 44831490395,
    'repeatBaselineTerminalCircuitsByteIdentical': sum(bool(row.get('circuitSha256')) and row.get('circuitSha256') == repeated[name].get('circuitSha256') for name, row in baseline.items()),
    'beforeStops': dict(Counter('budget' if row['stop'] != 'settled' else 'routing error' if row.get('errors', {}).get('pcb_autorouting_error') else 'settled' for row in baseline.values())),
    'afterStops': dict(Counter('budget' if row['stop'] != 'settled' else 'routing error' if row.get('errors', {}).get('pcb_autorouting_error') else 'settled' for row in fixed.values())),
    'beforeStages': dict(Counter(row['before']['stage'] for row in records)),
    'afterStages': dict(Counter(row['after']['stage'] for row in records)),
    'terminalPairsWithIdenticalCopper': sum(row['emittedCopperIdentical'] is True for row in records),
    'terminalPairsWithChangedCopper': sum(row['emittedCopperIdentical'] is False for row in records),
    'fix': 'Forward the existing rejectOverlappingTerminals option when native regional routing preserves physical geometry. One production line; dependencies unchanged.',
    'rootCause': 'Native regional repair omitted the existing terminal-overlap check. Searches with fixed unrelated endpoints closer than the requested trace width cannot succeed. A01 could then trim away a terminal layer transition and throw during via materialization.',
    'routingLimit': 'This is failure handling and wasted-search work, not additional routed copper. Budgeted runs do not establish final routing equivalence.',
    'otherFindings': ['Current IcePi-local remaining phase naturally solves its 79-connection graph; the old rectangle-based 355-connection repro is not the current pipeline.', 'Detailed routing remains a major blocker after graph success; H616 can request a 0.35 mm via transition in a 0.30 mm mesh cell, requiring physical regional repair.', 'Fanout stalls six variants. A standalone CPU profile of the current IcePi-native input spent about 25% in static candidate-cache lookup/key work and 13% cloning output obstacle connectivity. These are diagnostic samples, not performance comparisons.'],
    'rejectedConsumerProposal': 'The separate two-guard A01 correction preserved copper validity but added 58 seconds to OrangeCrab-local without changing emitted copper. The selected one-line consumer fix does not depend on it.',
    'boards': records,
}
(output_root / 'regional-terminal-analysis.json').write_text(json.dumps(summary, indent=2) + '\n')
with (output_root / 'regional-terminal-comparison.csv').open('w', newline='') as stream:
    writer = csv.writer(stream, lineterminator="\n")
    writer.writerow(['board', 'before_stage', 'after_stage', 'before_seconds', 'after_seconds', 'before_traces', 'after_traces', 'before_vias', 'after_vias', 'before_unconnected', 'after_unconnected', 'before_stop', 'after_stop', 'emitted_copper_identical'])
    for row in records:
        a, b = row['before']['result'], row['after']['result']
        writer.writerow([row['board'], row['before']['stage'], row['after']['stage'], a['seconds'], b['seconds'], a.get('traces', ''), b.get('traces', ''), a.get('vias', ''), b.get('vias', ''), a.get('errors', {}).get('pcb_port_not_connected_error', ''), b.get('errors', {}).get('pcb_port_not_connected_error', ''), a['stop'], b['stop'], row['emittedCopperIdentical']])
print(json.dumps({key: summary[key] for key in ['beforeStops', 'afterStops', 'beforeStages', 'afterStages', 'terminalPairsWithIdenticalCopper', 'terminalPairsWithChangedCopper']}))
