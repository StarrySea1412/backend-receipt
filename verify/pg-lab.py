"""Disposable PostgreSQL 16 demonstration. Connect only to an explicitly isolated lab."""
import argparse, os, queue, socket, subprocess, threading, time


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--psql', default='psql')
    p.add_argument('--port', type=int, required=True)
    p.add_argument('--database', required=True)
    p.add_argument('--user', default='lab')
    a = p.parse_args()
    if a.port == 5432 or a.database != 'backend_receipt_lab':
        p.error('use a non-default port and the disposable backend_receipt_lab database')
    env = dict(os.environ, PGCONNECT_TIMEOUT='4', PGCLIENTENCODING='UTF8')
    base = [a.psql, '-X', '-w', '-h', '127.0.0.1', '-p', str(a.port), '-d', a.database,
            '-U', a.user, '-Atq', '-v', 'ON_ERROR_STOP=1']

    def sql(s):
        return subprocess.check_output(base + ['-c', s], env=env, encoding='utf-8', timeout=12).strip()

    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        listener.listen()
        try:
            with socket.socket() as other:
                other.bind(listener.getsockname())
        except OSError:
            print('SOCKET listening | second bind blocked')
        else:
            raise AssertionError('unexpected second bind')
    print('POSTGRESQL', sql('show server_version'))
    sql('create table jobs (job_key text primary key, status text not null, owner int not null)')
    out = queue.Queue()
    start = threading.Barrier(21)

    def attempt():
        start.wait(timeout=12)
        try:
            value = sql("insert into jobs values ('k1','queued',0) on conflict (job_key) do nothing returning job_key")
            out.put(value)
        except Exception as exc:
            out.put(exc)

    workers = [threading.Thread(target=attempt) for _ in range(20)]
    for w in workers:
        w.start()
    start.wait(timeout=12)
    for w in workers:
        w.join(15)
    replies = [out.get_nowait() for _ in workers]
    assert sorted(replies) == [''] * 19 + ['k1']
    count = sql("select count(*) from jobs where job_key='k1'")
    assert count == '1'
    print(f'INSERT attempts={len(replies)} inserted={replies.count("k1")} rows={count}')

    gate = subprocess.Popen(base + ['-f','-'], env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            text=True, encoding='utf-8')
    try:
        gate.stdin.write("begin;\nselect job_key from jobs where job_key='k1' for update;\n")
        gate.stdin.flush()
        hold = queue.Queue()
        threading.Thread(target=lambda: hold.put(gate.stdout.readline().strip()), daemon=True).start()
        assert hold.get(timeout=10) == 'k1'
        skip = sql("select count(*) from (select job_key from jobs where job_key='k1' for update skip locked) s")
        assert skip == '0'
        print(f'ROW LOCK held=1 skip_locked_rows={skip}')
        gate.stdin.write('commit;\n\\q\n')
        gate.stdin.flush()
        assert gate.wait(timeout=10) == 0
    finally:
        if gate.poll() is None:
            gate.terminate(); gate.wait(timeout=5)

    sql("update jobs set status='running',owner=2 where job_key='k1'")
    stale = sql("with touched as (update jobs set status='done' where job_key='k1' and owner=1 returning 1) select count(*) from touched")
    owner = sql("with touched as (update jobs set status='done' where job_key='k1' and owner=2 returning 1) select count(*) from touched")
    assert (stale,owner) == ('0','1')
    print(f'FENCE stale_owner_rows={stale} current_owner_rows={owner}')


if __name__ == '__main__':
    main()
