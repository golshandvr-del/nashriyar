// Portable database interface. Services only depend on `Db`, never on D1 or node:sqlite directly.

export type Row = Record<string, any>

export interface Db {
  all<T = Row>(sql: string, params?: unknown[]): Promise<T[]>
  first<T = Row>(sql: string, params?: unknown[]): Promise<T | null>
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>
  /** Execute multiple statements atomically (transaction). */
  batch(stmts: { sql: string; params?: unknown[] }[]): Promise<void>
  exec(sql: string): Promise<void>
}

const norm = (params: unknown[] = []) =>
  params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p))

// ───────── Cloudflare D1 ─────────
export function d1Db(d1: any): Db {
  return {
    async all(sql, params) {
      const r = await d1.prepare(sql).bind(...norm(params)).all()
      return r.results ?? []
    },
    async first(sql, params) {
      return (await d1.prepare(sql).bind(...norm(params)).first()) ?? null
    },
    async run(sql, params) {
      const r = await d1.prepare(sql).bind(...norm(params)).run()
      return { changes: r.meta?.changes ?? 0 }
    },
    async batch(stmts) {
      if (!stmts.length) return
      await d1.batch(stmts.map((s) => d1.prepare(s.sql).bind(...norm(s.params))))
    },
    async exec(sql) {
      await d1.exec(sql.replace(/\n/g, ' '))
    }
  }
}

// ───────── node:sqlite (self-hosted) ─────────
export function nodeSqliteDb(db: any): Db {
  const cache = new Map<string, any>()
  const stmt = (sql: string) => {
    let s = cache.get(sql)
    if (!s) {
      s = db.prepare(sql)
      cache.set(sql, s)
    }
    return s
  }
  const plain = (r: any) => (r ? { ...r } : r)
  return {
    async all(sql, params) {
      return stmt(sql).all(...norm(params)).map(plain)
    },
    async first(sql, params) {
      return plain(stmt(sql).get(...norm(params))) ?? null
    },
    async run(sql, params) {
      const r = stmt(sql).run(...norm(params))
      return { changes: Number(r.changes ?? 0) }
    },
    async batch(stmts) {
      db.exec('BEGIN')
      try {
        for (const s of stmts) stmt(s.sql).run(...norm(s.params))
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    },
    async exec(sql) {
      db.exec(sql)
    }
  }
}
