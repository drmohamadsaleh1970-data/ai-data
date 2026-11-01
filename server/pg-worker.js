// PostgreSQL connection worker. The app's data layer is synchronous (it was written for
// SQLite), so server/pg.js runs every query through this worker thread and blocks on
// the answer with Atomics.wait. The worker owns the connection pool; the main thread
// only ever sees plain rows.
//
// server/pg.js imports this file so Vercel's bundler ships it (and the pg package) with
// the function. On the main thread, and in any worker not started by server/pg.js, it
// does nothing.
import { isMainThread, workerData } from 'node:worker_threads';

if (!isMainThread && workerData?.aihomePg) {
  start(workerData).catch((e) => {
    // Could not even load the driver: answer every request with the error instead of
    // leaving the main thread waiting.
    const signal = new Int32Array(workerData.state);
    workerData.port.on('message', () => {
      workerData.port.postMessage({ error: { message: `Database driver failed to start: ${e.message}`, code: 'DB_DRIVER' } });
      Atomics.store(signal, 0, 1);
      Atomics.notify(signal, 0);
    });
  });
}

// pg is loaded here, not at the top, so SQLite-only setups (local dev, tests) never need it.
async function start({ url, schema, state, port, poolMax }) {
  const signal = new Int32Array(state);
  const { default: pg } = await import('pg');
  // COUNT/SUM come back as bigint/numeric strings by default; the app expects numbers
  // (as SQLite gave it). Values here stay far below 2^53.
  pg.types.setTypeParser(20, (v) => Number(v));
  pg.types.setTypeParser(1700, (v) => Number(v));

  const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url) || /sslmode=disable/.test(url);
  const pool = new pg.Pool({
    connectionString: url,
    max: poolMax,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
    ssl: local ? false : { rejectUnauthorized: false },
  });
  // An idle connection dropped by the server (pooler restart, frozen function) must not
  // crash the process; the next query simply opens a new one.
  pool.on('error', (err) => console.error('[db] idle connection error', err.message));
  if (schema) {
    pool.on('connect', (client) => { client.query(`SET search_path TO "${schema}"`).catch(() => {}); });
  }

  let txClient = null;

  const reply = (msg) => {
    port.postMessage(msg);
    Atomics.store(signal, 0, 1);
    Atomics.notify(signal, 0);
  };

  const RETRYABLE = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT', '57P01', '57P02', '57P03', '08006', '08003', '08001']);
  const isConnErr = (e) => RETRYABLE.has(e?.code) || /Connection terminated|connection.*closed/i.test(e?.message || '');

  async function run(msg) {
    switch (msg.op) {
      case 'query': {
        if (txClient) return pick(await txClient.query(msg.sql, msg.params));
        try {
          return pick(await pool.query(msg.sql, msg.params));
        } catch (e) {
          if (!isConnErr(e)) throw e;
          return pick(await pool.query(msg.sql, msg.params)); // one retry on a dropped connection
        }
      }
      case 'exec': {
        if (txClient) { await txClient.query(msg.sql); return null; }
        await pool.query(msg.sql);
        return null;
      }
      case 'begin': {
        if (txClient) throw Object.assign(new Error('Nested transaction'), { code: 'NESTED_TX' });
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          // One write transaction at a time across every server instance, matching the
          // SQLite BEGIN IMMEDIATE behaviour the quota and billing logic was built on.
          await client.query('SELECT pg_advisory_xact_lock(784512903)');
        } catch (e) {
          client.release(true);
          throw e;
        }
        txClient = client;
        return null;
      }
      case 'commit':
      case 'rollback': {
        const client = txClient;
        txClient = null;
        if (!client) return null;
        try {
          await client.query(msg.op === 'commit' ? 'COMMIT' : 'ROLLBACK');
          client.release();
        } catch (e) {
          client.release(true);
          throw e;
        }
        return null;
      }
      case 'close': {
        await pool.end();
        return null;
      }
      default:
        throw new Error(`Unknown db op ${msg.op}`);
    }
  }

  port.on('message', (msg) => {
    run(msg).then(
      (result) => reply({ result }),
      (e) => reply({ error: { message: e.message, code: e.code, detail: e.detail, constraint: e.constraint } }),
    );
  });
}

function pick(res) {
  return { rows: res.rows, rowCount: res.rowCount };
}
