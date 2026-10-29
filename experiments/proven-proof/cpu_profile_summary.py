import collections
import hashlib
import json
from pathlib import Path
from urllib.parse import unquote, urlparse


def summarize_profile(path: Path, repo: Path) -> dict:
    raw = path.read_bytes()
    profile = json.loads(raw)
    nodes = profile.get('nodes')
    samples = profile.get('samples')
    if not isinstance(nodes, list) or not nodes or not isinstance(samples, list) or not samples:
        raise ValueError('CPU profile must contain nonempty nodes and samples')
    by_id = {node['id']: node for node in nodes}
    if len(by_id) != len(nodes):
        raise ValueError('CPU profile contains duplicate node IDs')
    parents = {}
    for node in nodes:
        for child in node.get('children', []):
            if child not in by_id or child in parents:
                raise ValueError('CPU profile children must form a tree')
            parents[child] = node['id']
    deltas = profile.get('timeDeltas')
    weighted = isinstance(deltas, list) and len(deltas) == len(samples)
    if weighted and any(not isinstance(value, (int, float)) or value < 0 for value in deltas):
        raise ValueError('CPU profile sample time deltas must be nonnegative')
    frames = {}
    node_keys = {}
    repo_prefix = str(repo.resolve()) + '/'
    for node in nodes:
        frame = node.get('callFrame') or {}
        url = frame.get('url') or ''
        filename = unquote(urlparse(url).path) if url.startswith('file:') else url
        if '/node_modules/' in filename:
            category = 'dependency'
        elif filename.startswith(repo_prefix):
            category = 'repository'
        elif '/experiments/proven-proof/' in filename:
            category = 'controller'
        elif not filename or filename.startswith(('bun:', 'node:')):
            category = 'runtime'
        else:
            category = 'other'
        display = '<SOURCE>/' + filename[len(repo_prefix):] if filename.startswith(repo_prefix) else filename
        key = (frame.get('functionName') or '(anonymous)', url, frame.get('lineNumber', -1), frame.get('columnNumber', -1))
        node_keys[node['id']] = key
        if key not in frames:
            frames[key] = {
                'functionName': key[0], 'url': url, 'file': display, 'category': category,
                'sourceLine': key[2] + 1 if key[2] >= 0 else None,
                'sourceColumn': key[3] + 1 if key[3] >= 0 else None,
                'selfSamples': 0, 'inclusiveSamples': 0,
                'selfWeight': 0, 'inclusiveWeight': 0,
            }
    ancestry = {}
    total_weight = 0
    for index, leaf in enumerate(samples):
        if leaf not in by_id:
            raise ValueError('CPU profile sample references an absent node')
        if leaf not in ancestry:
            current = leaf
            seen_nodes = set()
            seen_functions = set()
            while current is not None:
                if current in seen_nodes:
                    raise ValueError('CPU profile contains an ancestry cycle')
                seen_nodes.add(current)
                seen_functions.add(node_keys[current])
                current = parents.get(current)
            ancestry[leaf] = seen_functions
        weight = deltas[index] if weighted else 1
        total_weight += weight
        frames[node_keys[leaf]]['selfSamples'] += 1
        frames[node_keys[leaf]]['selfWeight'] += weight
        for key in ancestry[leaf]:
            frames[key]['inclusiveSamples'] += 1
            frames[key]['inclusiveWeight'] += weight
    if total_weight <= 0:
        raise ValueError('CPU profile has no positive sample weight')
    functions = []
    categories = collections.defaultdict(lambda: {'selfSamples': 0, 'selfWeight': 0})
    for frame in frames.values():
        frame['selfPercent'] = frame['selfWeight'] / total_weight * 100
        frame['inclusivePercent'] = frame['inclusiveWeight'] / total_weight * 100
        if weighted:
            frame['selfSampledMs'] = frame['selfWeight'] / 1000
            frame['inclusiveSampledMs'] = frame['inclusiveWeight'] / 1000
        categories[frame['category']]['selfSamples'] += frame['selfSamples']
        categories[frame['category']]['selfWeight'] += frame['selfWeight']
        functions.append(frame)
    for category in categories.values():
        category['selfPercent'] = category['selfWeight'] / total_weight * 100
        if weighted:
            category['selfSampledMs'] = category['selfWeight'] / 1000
    return {
        'profileFile': str(path), 'profileSha256': hashlib.sha256(raw).hexdigest(),
        'profileBytes': len(raw), 'nodes': len(nodes), 'samples': len(samples),
        'timeDeltaWeightsAvailable': weighted,
        'weightUnit': 'microseconds' if weighted else 'sample-count',
        'totalSampleWeight': total_weight,
        'recordedDurationMs': (profile['endTime'] - profile['startTime']) / 1000 if isinstance(profile.get('startTime'), (int, float)) and isinstance(profile.get('endTime'), (int, float)) else None,
        'scope': 'Whole child process: module/input loading, constructor, routing, validation, hashing and shutdown. CPU profiling overhead makes elapsed time/RSS diagnostic only; no optimization gain claim.',
        'inclusiveSemantics': 'Each function counted at most once per sampled stack, including recursive stacks. Inclusive percentages overlap and must not be summed across functions.',
        'categoriesExclusive': dict(categories),
        'top50Self': sorted(functions, key=lambda frame: (-frame['selfWeight'], frame['functionName'], frame['file']))[:50],
        'top50Inclusive': sorted(functions, key=lambda frame: (-frame['inclusiveWeight'], frame['functionName'], frame['file']))[:50],
    }
