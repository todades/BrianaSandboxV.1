import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Neon exige SSL
});

let activeClient = null;
const exec = () => activeClient || pool;

function q(sql, params) {
  let i = 0;
  return { text: sql.replace(/\?/g, () => `$${++i}`), values: params };
}

class Statement {
  constructor(sql) { this.sql = sql; }
  async run(...params) {
    const { text, values } = q(this.sql, params);
    const isInsert = /^\s*INSERT/i.test(this.sql) && !/RETURNING/i.test(this.sql);
    const finalText = isInsert ? `${text} RETURNING id` : text;
    const r = await exec().query(finalText, values);
    return { lastInsertRowid: isInsert ? Number(r.rows[0].id) : undefined, changes: r.rowCount };
  }
  async get(...params) {
    const { text, values } = q(this.sql, params);
      return (await exec().query(text, values)).rows[0];
  }
  async all(...params) {
    const { text, values } = q(this.sql, params);
    return (await exec().query(text, values)).rows;
  }
}

export const db = {
  prepare: (sql) => new Statement(sql),
  exec: async (sql) => { await exec().query(sql); },
  pragma: async () => {},
  transaction: (fn) => async () => {
    const client = await pool.connect();
    const prev = activeClient;
    activeClient = client;
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      activeClient = prev;
      client.release();
    }
  },
};

export default db;