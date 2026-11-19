"""Loopback HTTP app + fault-injecting relay + disposable PostgreSQL. No external requests."""
import argparse
from contextlib import ExitStack, contextmanager
import hashlib
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import subprocess
import threading
from urllib.parse import urlsplit


TIMEOUT = 2.0
BODY = {'document': 'sample.txt'}
CHANGED = {'document': 'different.txt'}


def canonical(body):
    return json.dumps(body, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


def handler_factory(dispatch):
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            size = int(self.headers.get('Content-Length', 0))
            status, body = dispatch(self.path, self.headers, self.rfile.read(size))
            if status is not None:
                encoded = canonical(body)
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)

        def log_message(self, *_):
            pass
    return Handler


@contextmanager
def serving(dispatch):
    with ThreadingHTTPServer(('127.0.0.1', 0), handler_factory(dispatch)) as server:
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            yield server.server_port
        finally:
            server.shutdown()
            worker.join()


def request(port, request_id, key, body, timeout):
    conn = http.client.HTTPConnection('127.0.0.1', port, timeout=timeout)
    try:
        conn.request('POST', '/jobs', canonical(body), {
            'Content-Type': 'application/json', 'Idempotency-Key': key, 'X-Request-Id': request_id,
        })
        response = conn.getresponse()
        return response.status, json.loads(response.read())
    finally:
        conn.close()


def execute(a):
    base = [a.psql, '-X', '-w', '-h', '127.0.0.1', '-p', str(a.port), '-d', a.database,
            '-U', a.user, '-Atq', '-v', 'ON_ERROR_STOP=1']
    env = dict(os.environ, PGCONNECT_TIMEOUT='4', PGCLIENTENCODING='UTF8')

    def sql(statement):
        return subprocess.check_output(base + ['-c', statement], env=env, encoding='utf-8', timeout=8).strip()

    pg_version = sql('SHOW server_version')
    sql('''CREATE TABLE receipt_jobs (
        job_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        idempotency_key text NOT NULL UNIQUE,
        fingerprint text NOT NULL
    )''')
    trace = {}

    def app(route, headers, raw):
        rid, key = headers['X-Request-Id'], headers['Idempotency-Key']
        if urlsplit(route).path != '/jobs' or not re.fullmatch(r'[ab]-(?:01|02|03|04)', rid or ''):
            return 404, {'error': 'lab route'}
        if not re.fullmatch(r'lab-[ab]-0[12]', key or ''):
            return 400, {'error': 'lab key'}
        digest = hashlib.sha256(canonical(json.loads(raw))).hexdigest()
        trace[rid] = [f'app: entered POST /jobs request_id={rid} key={key}']
        # psql must exit successfully after COMMIT before a response is constructed.
        # The later SELECT is a separate statement under Read Committed.
        inserted = sql(f"""BEGIN ISOLATION LEVEL READ COMMITTED;
            INSERT INTO receipt_jobs(idempotency_key, fingerprint) VALUES ('{key}', '{digest}')
            ON CONFLICT (idempotency_key) DO NOTHING RETURNING job_id;
            COMMIT""")
        if inserted:
            job = int(inserted)
            trace[rid].append(f'db: COMMIT inserted job_id={job}')
            return 202, {'job_id': job}
        job, found = sql(f"SELECT job_id, fingerprint FROM receipt_jobs WHERE idempotency_key='{key}'").split('|')
        if found != digest:
            trace[rid].append(f'db: existing job_id={job}, fingerprint mismatch')
            return 409, {'error': 'same key, different payload'}
        trace[rid].append(f'db: reuse job_id={job}')
        return 202, {'job_id': int(job)}

    def rows(prefix):
        result = sql(f"SELECT job_id, idempotency_key FROM receipt_jobs WHERE idempotency_key LIKE 'lab-{prefix}-%' ORDER BY job_id")
        return [line.replace('|', '  ') for line in result.splitlines()]

    labs = []
    with ExitStack() as cs:
        upstream = cs.enter_context(serving(app))
        for letter, mode in [('a', 'not-forwarded'), ('b', 'reply-withheld')]:
            initial, retry, mismatch, new = [f'{letter}-0{i}' for i in range(1, 5)]
            key, other = f'lab-{letter}-01', f'lab-{letter}-02'
            observed, release = threading.Event(), threading.Event()
            relay_log = []

            def relay(route, headers, raw):
                rid, k = headers['X-Request-Id'], headers['Idempotency-Key']
                if rid == initial and mode == 'not-forwarded':
                    relay_log.append(f'relay: received request_id={rid}; not forwarded')
                    observed.set()
                    release.wait(6)
                    return None, None
                status, payload = request(upstream, rid, k, json.loads(raw), timeout=5)
                if rid == initial:
                    relay_log.append(f'relay: read upstream HTTP {status}; response withheld')
                    observed.set()
                    release.wait(6)
                    return None, None
                return status, payload

            with serving(relay) as port:
                try:
                    request(port, initial, key, BODY, timeout=TIMEOUT)
                    raise AssertionError('client did not time out')
                except TimeoutError:
                    assert observed.is_set(), 'relay decision/commit not observed before deadline'
                finally:
                    release.set()
                before = rows(letter)
                before_app = trace.get(initial, [])
                assert len(before) == int(mode == 'reply-withheld')
                assert bool(before_app) == (mode == 'reply-withheld')
                status, payload = request(port, retry, key, BODY, timeout=5)
                assert status == 202
                job = payload['job_id']
                if before:
                    assert before[0] == f'{job}  {key}'
                after = rows(letter)
                assert after == [f'{job}  {key}']
                failed, conflict = request(port, mismatch, key, CHANGED, timeout=5)
                assert failed == 409 and rows(letter) == after
                duplicate, second = request(port, new, other, BODY, timeout=5)
                extra = rows(letter)
                assert duplicate == 202 and second['job_id'] != job and len(extra) == 2
                labs.append({
                    'id': letter.upper(), 'key': key, 'mode': mode, 'client': 'TimeoutError: timed out',
                    'app': before_app, 'relay': relay_log, 'before': before,
                    'retry': {'status': status, 'body': payload, 'rows': after, 'app': trace[retry]},
                    'conflict': {'status': failed, 'body': conflict, 'rows': after},
                    'newKey': {'status': duplicate, 'body': second, 'rows': extra},
                })
    return {'postgres': pg_version, 'timeoutMs': int(TIMEOUT * 1000), 'cases': labs}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--psql', default='psql')
    p.add_argument('--port', type=int, required=True)
    p.add_argument('--database', required=True)
    p.add_argument('--user', default='lab')
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    if not (1024 < a.port < 65536) or a.port == 5432 or a.database != 'backend_receipt_lab':
        p.error('use a non-default port and a disposable database named backend_receipt_lab')
    data = execute(a)
    a.output.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    for case in data['cases']:
        r = case['retry']
        print(f"{case['id']} {case['client']} | app_entries={len(case['app']) > 0:d} | rows={len(case['before'])}->{len(r['rows'])} | HTTP {r['status']} job_id={r['body']['job_id']} | changed_payload={case['conflict']['status']} | with_fresh_key={len(case['newKey']['rows'])}")


if __name__ == '__main__':
    main()
