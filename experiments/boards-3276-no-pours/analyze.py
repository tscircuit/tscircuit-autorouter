from pathlib import Path
import collections, csv, gzip, json

experiment = Path(__file__).resolve().parent
root = Path('/workspace/work/results-3276-no-pours')
before = {r['board']: r for r in json.loads((root / 'base/matrix.json').read_text())}
after = {r['board']: r for r in json.loads((root / 'fix/matrix.json').read_text())}
assert before.keys() == after.keys() and len(before) == 19
rows, differences = [], []
stages = collections.Counter()
routing_errors = ['pcb_autorouting_error', 'pcb_trace_missing_error', 'pcb_port_not_connected_error']
for board, b in before.items():
    a = after[board]
    bd, ad = root / 'base' / b['variant'] / board, root / 'fix' / a['variant'] / board
    be = [json.loads(line) for line in (bd / 'events.jsonl').read_text().splitlines()]
    ae = [json.loads(line) for line in (ad / 'events.jsonl').read_text().splitlines()]
    active = [e for e in ae if e['key'] in ['pipeline-failure', 'pipeline-stage', 'bus-progress', 'fanout', 'fanout-progress']]
    last = active[-1]
    stage = 'fanout' if last['key'].startswith('fanout') else 'bus lanes' if last['key'] == 'bus-progress' else last['phase']
    stages[stage] += 1
    same_copper, same_circuit = None, None
    if b['stop'] == a['stop'] == 'settled':
        bc = json.loads(gzip.decompress((bd / 'circuit.json.gz').read_bytes()))
        ac = json.loads(gzip.decompress((ad / 'circuit.json.gz').read_bytes()))
        assert not any(e['type'] == 'pcb_copper_pour' for e in bc + ac)
        same_copper = [e for e in bc if e['type'] in ['pcb_trace', 'pcb_via']] == [e for e in ac if e['type'] in ['pcb_trace', 'pcb_via']]
        same_circuit = bc == ac
        if not same_circuit:
            removed, added = [e for e in bc if e not in ac], [e for e in ac if e not in bc]
            differences.append({'board': board, 'removedTypes': dict(collections.Counter(e['type'] for e in removed)), 'addedTypes': dict(collections.Counter(e['type'] for e in added)), 'removed': removed, 'added': added})
    bf = [e for e in be if e['key'] == 'pipeline-failure']
    af = [e for e in ae if e['key'] == 'pipeline-failure']
    rows.append({'board': board, 'beforeStop': b['stop'], 'afterStop': a['stop'], 'beforeTraces': b.get('traces'), 'afterTraces': a.get('traces'), 'beforeVias': b.get('vias'), 'afterVias': a.get('vias'), 'sameEmittedCopper': same_copper, 'sameFullCircuitJson': same_circuit, 'beforeErrors': b.get('errors'), 'afterErrors': a.get('errors'), 'beforeSeconds': b['seconds'], 'afterSeconds': a['seconds'], 'beforePipelineError': bf[-1]['error'] if bf else None, 'afterPipelineError': af[-1]['error'] if af else None, 'afterBlockingStage': stage})
base_inputs = json.loads((experiment / 'base-input-hashes.json').read_text())
fix_inputs = json.loads((experiment / 'fix-input-hashes.json').read_text())
common = sorted(base_inputs.keys() & fix_inputs.keys())
changed_inputs = [name for name in common if base_inputs[name] != fix_inputs[name]]
regressions = [r['board'] for r in rows if (r['beforeStop'] == 'settled' and r['afterStop'] != 'settled') or r['sameEmittedCopper'] is False or (r['beforeErrors'] and r['afterErrors'] and sum(r['afterErrors'].get(k, 0) for k in routing_errors) > sum(r['beforeErrors'].get(k, 0) for k in routing_errors))]
summary = {'boards': 19, 'copperPours': False, 'fullyRoutedBefore': sum(r['stop'] == 'settled' and not any(r.get('errors', {}).get(k, 0) for k in routing_errors) for r in before.values()), 'fullyRoutedAfter': sum(r['stop'] == 'settled' and not any(r.get('errors', {}).get(k, 0) for k in routing_errors) for r in after.values()), 'settledBefore': sum(r['stop'] == 'settled' for r in before.values()), 'settledAfter': sum(r['stop'] == 'settled' for r in after.values()), 'identicalEmittedCopper': sum(r['sameEmittedCopper'] is True for r in rows), 'identicalFullOutputs': sum(r['sameFullCircuitJson'] is True for r in rows), 'commonInputFiles': len(common), 'changedCommonInputs': changed_inputs, 'possibleRegressions': regressions, 'blockingStagesAfter': dict(stages), 'interpretation': 'Captured-stage progress is not whole-board completion. Failed phases do not publish partial traces. Timings are contended observations, with no speedup claim. Timeout outputs cannot be compared.'}
for name, data in [('comparison.json', rows), ('analysis.json', summary), ('output-differences.json', differences)]:
    (experiment / name).write_text(json.dumps(data, indent=2) + '\n')
with (experiment / 'comparison.csv').open('w') as f:
    writer = csv.DictWriter(f, fieldnames=list(rows[0]), lineterminator='\n'); writer.writeheader(); writer.writerows(rows)
with (experiment / 'summary.csv').open('w') as f:
    writer = csv.writer(f, lineterminator='\n'); writer.writerow(['Board', 'Blocking stage', 'Outcome before / after', 'Traces before / after', 'Vias before / after', 'Emitted copper'])
    for r in rows:
        settled = r['afterStop'] == 'settled'
        writer.writerow([r['board'], r['afterBlockingStage'], 'Routing errors / routing errors' if settled else '600s timeout / 600s timeout', f"{r['beforeTraces']} / {r['afterTraces']}" if settled else 'Unknown', f"{r['beforeVias']} / {r['afterVias']}" if settled else 'Unknown', 'Identical' if r['sameEmittedCopper'] else 'No completed output'])
print(json.dumps(summary, indent=2))
