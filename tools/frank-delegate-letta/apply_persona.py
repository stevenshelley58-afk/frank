#!/usr/bin/env python3
"""PATCH the live frank-central persona block using the label path
(/core-memory/blocks/persona — NOT the block id).
"""
import importlib.util
import json
import os
import urllib.request

LETTA = os.environ.get('LETTA_URL', 'http://localhost:8283').rstrip('/')

spec = importlib.util.spec_from_file_location('up', os.path.join(os.path.dirname(__file__), 'update_persona.py'))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
PERSONA = mod.PERSONA


def api(method, path, body=None):
    req = urllib.request.Request(
        LETTA + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json'},
        method=method,
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def main():
    agents = api('GET', '/v1/agents/?name=frank-central')
    aid = agents[0]['id']
    before = api('GET', f'/v1/agents/{aid}/core-memory/blocks/persona')
    print('old head:', before['value'][:80].replace('\n', ' | '))
    after = api('PATCH', f'/v1/agents/{aid}/core-memory/blocks/persona', {'value': PERSONA})
    print('new head:', after['value'][:80].replace('\n', ' | '))
    ok = 'unsure' in after['value'] and 'Vague requests' in after['value'] and 'delegate_task' in after['value']
    print('persona updated with new protocol:', ok)


if __name__ == '__main__':
    main()
