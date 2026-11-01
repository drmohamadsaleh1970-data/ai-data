// Synchronous PostgreSQL connection with the same surface the app uses from node:sqlite
// (prepare().get/all/run/iterate, exec). Queries run in server/pg-worker.js; this thread
// blocks until the answer arrives, so the existing synchronous code - including the
// transactions in tx() - works unchanged against Postgres.
import { Worker, MessageChannel, receiveMessageOnPort } from 'node:worker_threads';
import './pg-worker.js'; // keeps the worker file and the pg package in the Vercel bundle

const QUERY_TIMEOUT_MS = 60_000;

export class PgConnection {
  constructor(url, { schema = null, poolMax = 3, idTables = new Set() } = {}) {
    this.idTables = idTables;
    this.inTx = false;
    this.state = new Int32Array(new SharedArrayBuffer(4));
    const { port1, port2 } = new MessageChannel();
    this.port = port1;
    this.worker = new Worker(new URL('./pg-worker.js', import.meta.url), {
      workerData: { aihomePg: true, url, schema, state: this.state.buffer, port: port2, poolMax },
      transferList: [port2],
    });
    this.worker.unref();
    this.worker.on('error', (e) => console.error('[db] worker error', e));
    this.statements = new Map();
  }

  call(msg) {
    Atomics.store(this.state, 0, 0);
    this.port.postMessage(msg);
    const waited = Atomics.wait(this.state, 0, 0, QUERY_TIMEOUT_MS);
    const got = receiveMessageOnPort(this.port);
    if (!got) {
      throw Object.assign(new Error(waited === 'timed-out' ? 'Database did not answer in time' : 'Database worker gave no answer'), { code: 'DB_TIMEOUT' });
    }
    const { result, error } = got.message;
    if (error) throw Object.assign(new Error(error.message), error);
    return result;
  }

  prepare(sql) {
    let s = this.statements.get(sql);
    if (!s) {
      s = new PgStatement(this, sql);
      if (this.statements.size > 500) this.statements.clear();
      this.statements.set(sql, s);
    }
    return s;
  }

  exec(sql) {
    const word = sql.trim().replace(/;$/, '').toUpperCase();
    if (word === 'BEGIN' || word.startsWith('BEGIN ')) { this.call({ op: 'begin' }); this.inTx = true; return; }
    if (word === 'COMMIT' || word === 'ROLLBACK') { this.inTx = false; this.call({ op: word.toLowerCase() }); return; }
    this.call({ op: 'exec', sql });
  }

  close() {
    try { this.call({ op: 'close' }); } finally { this.worker.terminate(); }
  }
}

class PgStatement {
  constructor(conn, sql) {
    this.conn = conn;
    this.sql = toPositional(sql);
    const ins = /^\s*INSERT\s+INTO\s+(\w+)/i.exec(sql);
    // node:sqlite's run() reports lastInsertRowid; Postgres needs RETURNING for that.
    this.returningId = !!ins && conn.idTables.has(ins[1].toLowerCase()) && !/\bRETURNING\b/i.test(sql);
    if (this.returningId) this.sql += ' RETURNING id';
  }

  query(params) {
    return this.conn.call({ op: 'query', sql: this.sql, params: params.map(toParam) });
  }

  get(...params) { return this.query(params).rows[0]; }
  all(...params) { return this.query(params).rows; }
  iterate(...params) { return this.query(params).rows[Symbol.iterator](); }
  run(...params) {
    const r = this.query(params);
    return { changes: r.rowCount ?? 0, lastInsertRowid: this.returningId ? r.rows[0]?.id : undefined };
  }
}

// SQLite stores booleans as 0/1 and accepts undefined as NULL; mirror that.
function toParam(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'bigint') return v.toString();
  return v;
}

// '?' placeholders -> $1, $2, ... (skipping quoted strings, identifiers and comments).
export function toPositional(sql) {
  let out = '';
  let n = 0;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'" || c === '"') {
      const end = sql.indexOf(c, i + 1);
      const stop = end === -1 ? sql.length : end + 1;
      out += sql.slice(i, stop);
      i = stop - 1;
    } else if (c === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      out += sql.slice(i, stop);
      i = stop - 1;
    } else if (c === '?') {
      out += '$' + ++n;
    } else {
      out += c;
    }
  }
  return out;
}
