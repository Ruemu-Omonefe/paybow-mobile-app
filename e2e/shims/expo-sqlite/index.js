// expo-sqlite API subset on top of node:sqlite (tests the REAL SQL + transaction semantics of the app's data layer)
const { DatabaseSync } = require('node:sqlite');
let tx = Promise.resolve();
module.exports = {
  openDatabaseAsync: async () => {
    const db = new DatabaseSync(':memory:');
    return {
      execAsync: async (sql) => db.exec(sql),
      runAsync: async (sql, p = []) => db.prepare(sql).run(...p),
      getFirstAsync: async (sql, p = []) => db.prepare(sql).get(...p) ?? null,
      getAllAsync: async (sql, p = []) => db.prepare(sql).all(...p),
      withTransactionAsync: async (fn) => {
        db.exec('BEGIN');
        try { await fn(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
      },
    };
  },
};
