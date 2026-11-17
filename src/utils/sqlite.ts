import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import {
  Product,
  Customer,
  Supplier,
  Invoice,
  Purchase,
  StockMovement,
  PaymentRecord,
  Expense,
  BusinessSettings,
  SyncLog,
  SyncQueueItem,
  ConflictRecord,
  DatabaseSnapshotMeta,
  SqliteStats,
} from '../types';

const SQLITE_IDB_NAME = 'BusinessMindSQLiteStorage';
const SQLITE_IDB_STORE = 'sqlite_files';
const SQLITE_MAIN_KEY = 'business_mind_main_db_v1';

export type SqliteCollectionName =
  | 'products'
  | 'customers'
  | 'suppliers'
  | 'invoices'
  | 'purchases'
  | 'stock_movements'
  | 'payments'
  | 'expenses';

let SQL: SqlJsStatic | null = null;
let dbInstance: Database | null = null;
let initPromise: Promise<boolean> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let lastKnownBytesLength = 0;

function openSqliteIdb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(SQLITE_IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(SQLITE_IDB_STORE)) {
          db.createObjectStore(SQLITE_IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function loadDbBytesFromIdb(): Promise<Uint8Array | null> {
  const idb = await openSqliteIdb();
  if (!idb) return null;
  return new Promise((resolve) => {
    try {
      const tx = idb.transaction(SQLITE_IDB_STORE, 'readonly');
      const req = tx.objectStore(SQLITE_IDB_STORE).get(SQLITE_MAIN_KEY);
      req.onsuccess = () => {
        const val = req.result;
        if (val instanceof Uint8Array) {
          resolve(val);
        } else if (val instanceof ArrayBuffer) {
          resolve(new Uint8Array(val));
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function saveDbBytesToIdb(bytes: Uint8Array): Promise<void> {
  const idb = await openSqliteIdb();
  if (!idb) return;
  lastKnownBytesLength = bytes.byteLength;
  await new Promise<void>((resolve) => {
    try {
      const tx = idb.transaction(SQLITE_IDB_STORE, 'readwrite');
      tx.objectStore(SQLITE_IDB_STORE).put(bytes, SQLITE_MAIN_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export function scheduleSqlitePersist(immediate = false): void {
  if (!dbInstance) return;
  const runPersist = () => {
    if (!dbInstance) return;
    try {
      const exported = dbInstance.export();
      saveDbBytesToIdb(exported).catch(() => {});
    } catch (err) {
      console.warn('SQLite export persist error:', err);
    }
  };

  if (immediate) {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    runPersist();
    return;
  }

  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    runPersist();
  }, 150);
}

function createSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT,
      code TEXT,
      barcode TEXT,
      category TEXT,
      updated_at TEXT,
      version INTEGER DEFAULT 1,
      data_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT,
      phone TEXT,
      outstanding_due REAL DEFAULT 0,
      updated_at TEXT,
      version INTEGER DEFAULT 1,
      data_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      name TEXT,
      phone TEXT,
      outstanding_due REAL DEFAULT 0,
      updated_at TEXT,
      version INTEGER DEFAULT 1,
      data_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      invoice_number TEXT,
      date TEXT,
      customer_id TEXT,
      grand_total REAL DEFAULT 0,
      due_amount REAL DEFAULT 0,
      payment_status TEXT,
      updated_at TEXT,
      version INTEGER DEFAULT 1,
      data_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY,
      purchase_number TEXT,
      purchase_date TEXT,
      supplier_id TEXT,
      grand_total REAL DEFAULT 0,
      updated_at TEXT,
      version INTEGER DEFAULT 1,
      data_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS stock_movements (
      id TEXT PRIMARY KEY,
      product_id TEXT,
      variant_id TEXT,
      type TEXT,
      timestamp TEXT,
      updated_at TEXT,
      version INTEGER DEFAULT 1,
      data_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      type TEXT,
      party_id TEXT,
      amount REAL DEFAULT 0,
      payment_date TEXT,
      updated_at TEXT,
      version INTEGER DEFAULT 1,
      data_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      title TEXT,
      category TEXT,
      amount REAL DEFAULT 0,
      date TEXT,
      updated_at TEXT,
      version INTEGER DEFAULT 1,
      data_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_queue (
      op_id TEXT PRIMARY KEY,
      collection_name TEXT NOT NULL,
      doc_id TEXT NOT NULL,
      op_type TEXT NOT NULL,
      payload_json TEXT,
      version INTEGER DEFAULT 1,
      updated_at TEXT NOT NULL,
      attempts INTEGER DEFAULT 0,
      last_error TEXT
    );
    CREATE TABLE IF NOT EXISTS db_snapshots (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      reason TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      summary TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS image_cache (
      url TEXT PRIMARY KEY,
      data_url TEXT NOT NULL,
      mime_type TEXT,
      size_bytes INTEGER DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conflict_log (
      id TEXT PRIMARY KEY,
      collection_name TEXT NOT NULL,
      doc_id TEXT NOT NULL,
      local_version INTEGER DEFAULT 1,
      cloud_version INTEGER DEFAULT 1,
      local_updated_at TEXT,
      cloud_updated_at TEXT,
      winner TEXT NOT NULL,
      resolved_at TEXT NOT NULL
    );
  `);
}

function queryScalarNumber(db: Database, sql: string): number {
  const res = db.exec(sql);
  if (!res.length || !res[0].values.length) return 0;
  return Number(res[0].values[0][0]) || 0;
}

export function isSqliteReady(): boolean {
  return dbInstance !== null;
}

export function getSqliteDb(): Database | null {
  return dbInstance;
}

export async function initSqliteDatabase(): Promise<boolean> {
  if (dbInstance) return true;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      SQL = await initSqlJs({
        locateFile: () => '/sql-wasm.wasm',
      });
      const existingBytes = await loadDbBytesFromIdb();
      if (existingBytes && existingBytes.byteLength > 0) {
        try {
          dbInstance = new SQL.Database(existingBytes);
          createSchema(dbInstance);
          lastKnownBytesLength = existingBytes.byteLength;
        } catch {
          dbInstance = new SQL.Database();
          createSchema(dbInstance);
        }
      } else {
        dbInstance = new SQL.Database();
        createSchema(dbInstance);
      }

      // Flush localStorage -> SQLite if SQLite tables are empty while localStorage has data
      migrateLocalStorageIntoSqliteIfEmpty();
      // Hydrate SQLite -> localStorage if localStorage was wiped (e.g., after app/WebView update)
      hydrateLocalStorageFromSqlite();
      scheduleSqlitePersist(true);
      return true;
    } catch (err) {
      console.error('SQLite initialization failed, falling back gracefully:', err);
      return false;
    }
  })();

  return initPromise;
}

const STORAGE_TO_TABLE: Array<{ lsKey: string; table: SqliteCollectionName }> = [
  { lsKey: 'bm_products_v1', table: 'products' },
  { lsKey: 'bm_customers_v1', table: 'customers' },
  { lsKey: 'bm_suppliers_v1', table: 'suppliers' },
  { lsKey: 'bm_invoices_v1', table: 'invoices' },
  { lsKey: 'bm_purchases_v1', table: 'purchases' },
  { lsKey: 'bm_stock_movements_v1', table: 'stock_movements' },
  { lsKey: 'bm_payments_v1', table: 'payments' },
  { lsKey: 'bm_expenses_v1', table: 'expenses' },
];

const KV_MIRROR_KEYS = [
  'bm_settings_v1',
  'bm_categories_v1',
  'bm_sync_logs_v1',
  'bm_has_user_data_v1',
  'bm_pending_cloud_sync_v1',
  'bm_cached_auth_user_v1',
  'bm_cached_users_list_v1',
  'bm_deleted_cloud_queue_v1',
  'bm_offline_pin_v1',
  'bm_last_fb_sync',
  'bm_auto_firebase_sync',
];

function migrateLocalStorageIntoSqliteIfEmpty(): void {
  if (!dbInstance) return;
  for (const { lsKey, table } of STORAGE_TO_TABLE) {
    const count = queryScalarNumber(dbInstance, `SELECT COUNT(*) FROM ${table}`);
    if (count === 0) {
      const raw = localStorage.getItem(lsKey);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            replaceCollectionInSqlite(table, parsed, false);
          }
        } catch {
          // ignore
        }
      }
    }
  }

  for (const key of KV_MIRROR_KEYS) {
    const existing = getKvFromSqlite(key);
    if (existing === null) {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        setKvInSqlite(key, raw, false);
      }
    }
  }
}

export function hydrateLocalStorageFromSqlite(): void {
  if (!dbInstance) return;
  for (const { lsKey, table } of STORAGE_TO_TABLE) {
    const lsRaw = localStorage.getItem(lsKey);
    if (!lsRaw) {
      const rows = readCollectionFromSqlite<any>(table);
      if (rows.length > 0) {
        try {
          localStorage.setItem(lsKey, JSON.stringify(rows));
        } catch {
          // ignore
        }
      }
    }
  }

  for (const key of KV_MIRROR_KEYS) {
    if (localStorage.getItem(key) === null) {
      const val = getKvFromSqlite(key);
      if (val !== null) {
        try {
          localStorage.setItem(key, val);
        } catch {
          // ignore
        }
      }
    }
  }
}

export function readCollectionFromSqlite<T>(table: SqliteCollectionName): T[] {
  if (!dbInstance) return [];
  try {
    const res = dbInstance.exec(`SELECT data_json FROM ${table}`);
    if (!res.length) return [];
    const items: T[] = [];
    for (const row of res[0].values) {
      try {
        items.push(JSON.parse(String(row[0])) as T);
      } catch {
        // skip corrupted row
      }
    }
    return items;
  } catch {
    return [];
  }
}

export function replaceCollectionInSqlite(
  table: SqliteCollectionName,
  items: any[],
  persist = true
): void {
  if (!dbInstance) return;
  try {
    dbInstance.run('BEGIN TRANSACTION');
    dbInstance.run(`DELETE FROM ${table}`);

    let sql = '';
    switch (table) {
      case 'products':
        sql = `INSERT OR REPLACE INTO products (id, name, code, barcode, category, updated_at, version, data_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        break;
      case 'customers':
        sql = `INSERT OR REPLACE INTO customers (id, name, phone, outstanding_due, updated_at, version, data_json) VALUES (?, ?, ?, ?, ?, ?, ?)`;
        break;
      case 'suppliers':
        sql = `INSERT OR REPLACE INTO suppliers (id, name, phone, outstanding_due, updated_at, version, data_json) VALUES (?, ?, ?, ?, ?, ?, ?)`;
        break;
      case 'invoices':
        sql = `INSERT OR REPLACE INTO invoices (id, invoice_number, date, customer_id, grand_total, due_amount, payment_status, updated_at, version, data_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        break;
      case 'purchases':
        sql = `INSERT OR REPLACE INTO purchases (id, purchase_number, purchase_date, supplier_id, grand_total, updated_at, version, data_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        break;
      case 'stock_movements':
        sql = `INSERT OR REPLACE INTO stock_movements (id, product_id, variant_id, type, timestamp, updated_at, version, data_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        break;
      case 'payments':
        sql = `INSERT OR REPLACE INTO payments (id, type, party_id, amount, payment_date, updated_at, version, data_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        break;
      case 'expenses':
        sql = `INSERT OR REPLACE INTO expenses (id, title, category, amount, date, updated_at, version, data_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        break;
    }

    const stmt = dbInstance.prepare(sql);
    for (const item of items) {
      if (!item || !item.id) continue;
      const json = JSON.stringify(item);
      const updatedAt = item.updated_at || item.created_at || item.timestamp || item.date || new Date().toISOString();
      const version = Number(item.version) || 1;

      if (table === 'products') {
        stmt.run([item.id, item.name || '', item.code || '', item.barcode || '', item.category || '', updatedAt, version, json]);
      } else if (table === 'customers') {
        stmt.run([item.id, item.name || '', item.phone || '', Number(item.outstanding_due) || 0, updatedAt, version, json]);
      } else if (table === 'suppliers') {
        stmt.run([item.id, item.name || '', item.phone || '', Number(item.outstanding_due) || 0, updatedAt, version, json]);
      } else if (table === 'invoices') {
        stmt.run([item.id, item.invoice_number || '', item.date || '', item.customer_id || '', Number(item.grand_total) || 0, Number(item.due_amount) || 0, item.payment_status || 'paid', updatedAt, version, json]);
      } else if (table === 'purchases') {
        stmt.run([item.id, item.purchase_number || '', item.purchase_date || '', item.supplier_id || '', Number(item.grand_total) || 0, updatedAt, version, json]);
      } else if (table === 'stock_movements') {
        stmt.run([item.id, item.product_id || '', item.variant_id || '', item.type || '', item.timestamp || '', updatedAt, version, json]);
      } else if (table === 'payments') {
        stmt.run([item.id, item.type || 'customer', item.party_id || '', Number(item.amount) || 0, item.payment_date || '', updatedAt, version, json]);
      } else if (table === 'expenses') {
        stmt.run([item.id, item.title || '', item.category || '', Number(item.amount) || 0, item.date || '', updatedAt, version, json]);
      }
    }
    stmt.free();
    dbInstance.run('COMMIT');
    if (persist) scheduleSqlitePersist();
  } catch (err) {
    try {
      dbInstance.run('ROLLBACK');
    } catch {
      // ignore
    }
    console.warn(`SQLite replace failed for ${table}:`, err);
  }
}

export function getKvFromSqlite(key: string): string | null {
  if (!dbInstance) return null;
  try {
    const stmt = dbInstance.prepare('SELECT value_json FROM kv_store WHERE key = ?');
    stmt.bind([key]);
    let result: string | null = null;
    if (stmt.step()) {
      result = String(stmt.get()[0]);
    }
    stmt.free();
    return result;
  } catch {
    return null;
  }
}

export function setKvInSqlite(key: string, rawValue: string | null, persist = true): void {
  if (!dbInstance) return;
  try {
    if (rawValue === null) {
      dbInstance.run('DELETE FROM kv_store WHERE key = ?', [key]);
    } else {
      dbInstance.run(
        'INSERT OR REPLACE INTO kv_store (key, value_json, updated_at) VALUES (?, ?, ?)',
        [key, rawValue, new Date().toISOString()]
      );
    }
    if (persist) scheduleSqlitePersist();
  } catch {
    // ignore
  }
}

// ============================================================
// Background Sync Queue Operations (Persistent SQLite Queue)
// ============================================================
export function enqueueSyncOperation(params: {
  collection_name: string;
  doc_id: string;
  op_type: 'upsert' | 'delete';
  payload?: any;
  version?: number;
  updated_at?: string;
}): void {
  if (!dbInstance) return;
  const opId = `${params.collection_name}::${params.doc_id}`;
  const updatedAt = params.updated_at || new Date().toISOString();
  const version = params.version || 1;
  const payloadJson = params.payload !== undefined ? JSON.stringify(params.payload) : null;

  try {
    dbInstance.run(
      `INSERT OR REPLACE INTO sync_queue (op_id, collection_name, doc_id, op_type, payload_json, version, updated_at, attempts, last_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL)`,
      [opId, params.collection_name, params.doc_id, params.op_type, payloadJson, version, updatedAt]
    );
    scheduleSqlitePersist();
  } catch (err) {
    console.warn('enqueueSyncOperation error:', err);
  }
}

export function getPendingSyncQueue(): SyncQueueItem[] {
  if (!dbInstance) return [];
  try {
    const res = dbInstance.exec(
      `SELECT op_id, collection_name, doc_id, op_type, payload_json, version, updated_at, attempts, last_error
       FROM sync_queue ORDER BY updated_at ASC`
    );
    if (!res.length) return [];
    return res[0].values.map((row) => ({
      op_id: String(row[0]),
      collection_name: String(row[1]),
      doc_id: String(row[2]),
      op_type: (row[3] === 'delete' ? 'delete' : 'upsert') as 'upsert' | 'delete',
      payload_json: row[4] ? String(row[4]) : undefined,
      version: Number(row[5]) || 1,
      updated_at: String(row[6]),
      attempts: Number(row[7]) || 0,
      last_error: row[8] ? String(row[8]) : undefined,
    }));
  } catch {
    return [];
  }
}

export function removeSyncQueueItems(opIds: string[]): void {
  if (!dbInstance || opIds.length === 0) return;
  try {
    dbInstance.run('BEGIN TRANSACTION');
    const stmt = dbInstance.prepare('DELETE FROM sync_queue WHERE op_id = ?');
    for (const id of opIds) {
      stmt.run([id]);
    }
    stmt.free();
    dbInstance.run('COMMIT');
    scheduleSqlitePersist();
  } catch {
    try {
      dbInstance.run('ROLLBACK');
    } catch {
      // ignore
    }
  }
}

export function markSyncQueueAttemptError(opIds: string[], errorMsg: string): void {
  if (!dbInstance || opIds.length === 0) return;
  try {
    dbInstance.run('BEGIN TRANSACTION');
    const stmt = dbInstance.prepare(
      'UPDATE sync_queue SET attempts = attempts + 1, last_error = ? WHERE op_id = ?'
    );
    for (const id of opIds) {
      stmt.run([errorMsg.slice(0, 240), id]);
    }
    stmt.free();
    dbInstance.run('COMMIT');
    scheduleSqlitePersist();
  } catch {
    try {
      dbInstance.run('ROLLBACK');
    } catch {
      // ignore
    }
  }
}

// ============================================================
// Conflict Logging
// ============================================================
export function recordConflictsToSqlite(conflicts: ConflictRecord[]): void {
  if (!dbInstance || conflicts.length === 0) return;
  try {
    dbInstance.run('BEGIN TRANSACTION');
    const stmt = dbInstance.prepare(
      `INSERT OR REPLACE INTO conflict_log
       (id, collection_name, doc_id, local_version, cloud_version, local_updated_at, cloud_updated_at, winner, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const c of conflicts) {
      stmt.run([
        c.id,
        c.collection,
        c.docId,
        c.localVersion,
        c.cloudVersion,
        c.localUpdatedAt,
        c.cloudUpdatedAt,
        c.winner,
        c.resolvedAt,
      ]);
    }
    stmt.free();
    // Keep latest 50 conflict entries
    dbInstance.run(
      `DELETE FROM conflict_log WHERE id NOT IN (SELECT id FROM conflict_log ORDER BY resolved_at DESC LIMIT 50)`
    );
    dbInstance.run('COMMIT');
    scheduleSqlitePersist();
  } catch {
    try {
      dbInstance.run('ROLLBACK');
    } catch {
      // ignore
    }
  }
}

export function getRecentConflictsFromSqlite(): ConflictRecord[] {
  if (!dbInstance) return [];
  try {
    const res = dbInstance.exec(
      `SELECT id, collection_name, doc_id, local_version, cloud_version, local_updated_at, cloud_updated_at, winner, resolved_at
       FROM conflict_log ORDER BY resolved_at DESC LIMIT 25`
    );
    if (!res.length) return [];
    return res[0].values.map((r) => ({
      id: String(r[0]),
      collection: String(r[1]),
      docId: String(r[2]),
      localVersion: Number(r[3]) || 1,
      cloudVersion: Number(r[4]) || 1,
      localUpdatedAt: String(r[5] || ''),
      cloudUpdatedAt: String(r[6] || ''),
      winner: (r[7] === 'local' ? 'local' : 'cloud') as 'local' | 'cloud',
      resolvedAt: String(r[8]),
    }));
  } catch {
    return [];
  }
}

// ============================================================
// Auto Backup & Snapshot Recovery (SQLite Rolling Snapshots)
// ============================================================
export interface FullBackupPayload {
  version: string;
  exported_at: string;
  settings: BusinessSettings | null;
  categories: string[];
  products: Product[];
  customers: Customer[];
  suppliers: Supplier[];
  invoices: Invoice[];
  purchases: Purchase[];
  stockMovements: StockMovement[];
  payments: PaymentRecord[];
  expenses: Expense[];
}

export function buildCurrentBackupPayloadFromStorage(): FullBackupPayload {
  const safeParse = <T,>(key: string, fallback: T): T => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  };

  return {
    version: '2.0-sqlite',
    exported_at: new Date().toISOString(),
    settings: safeParse<BusinessSettings | null>('bm_settings_v1', null),
    categories: safeParse<string[]>('bm_categories_v1', []),
    products: safeParse<Product[]>('bm_products_v1', []),
    customers: safeParse<Customer[]>('bm_customers_v1', []),
    suppliers: safeParse<Supplier[]>('bm_suppliers_v1', []),
    invoices: safeParse<Invoice[]>('bm_invoices_v1', []),
    purchases: safeParse<Purchase[]>('bm_purchases_v1', []),
    stockMovements: safeParse<StockMovement[]>('bm_stock_movements_v1', []),
    payments: safeParse<PaymentRecord[]>('bm_payments_v1', []),
    expenses: safeParse<Expense[]>('bm_expenses_v1', []),
  };
}

export function createDatabaseSnapshot(reason: 'auto' | 'manual' | 'pre_restore'): DatabaseSnapshotMeta | null {
  if (!dbInstance) return null;
  try {
    const payload = buildCurrentBackupPayloadFromStorage();
    const payloadJson = JSON.stringify(payload);
    const id = `snap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const createdAt = new Date().toISOString();
    const sizeBytes = new Blob([payloadJson]).size;
    const summary = `${payload.products.length} Products · ${payload.invoices.length} Invoices · ${payload.customers.length} Customers`;

    dbInstance.run(
      `INSERT INTO db_snapshots (id, created_at, reason, size_bytes, summary, payload_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, createdAt, reason, sizeBytes, summary, payloadJson]
    );

    // Keep rolling last 10 snapshots
    dbInstance.run(
      `DELETE FROM db_snapshots WHERE id NOT IN (SELECT id FROM db_snapshots ORDER BY created_at DESC LIMIT 10)`
    );
    scheduleSqlitePersist(true);

    return {
      id,
      created_at: createdAt,
      reason,
      size_bytes: sizeBytes,
      summary,
    };
  } catch (err) {
    console.warn('Snapshot creation error:', err);
    return null;
  }
}

export function listDatabaseSnapshots(): DatabaseSnapshotMeta[] {
  if (!dbInstance) return [];
  try {
    const res = dbInstance.exec(
      `SELECT id, created_at, reason, size_bytes, summary FROM db_snapshots ORDER BY created_at DESC`
    );
    if (!res.length) return [];
    return res[0].values.map((r) => ({
      id: String(r[0]),
      created_at: String(r[1]),
      reason: (r[2] as 'auto' | 'manual' | 'pre_restore') || 'auto',
      size_bytes: Number(r[3]) || 0,
      summary: String(r[4] || ''),
    }));
  } catch {
    return [];
  }
}

export function getSnapshotPayloadById(snapshotId: string): FullBackupPayload | null {
  if (!dbInstance) return null;
  try {
    const stmt = dbInstance.prepare('SELECT payload_json FROM db_snapshots WHERE id = ?');
    stmt.bind([snapshotId]);
    let jsonStr: string | null = null;
    if (stmt.step()) {
      jsonStr = String(stmt.get()[0]);
    }
    stmt.free();
    return jsonStr ? (JSON.parse(jsonStr) as FullBackupPayload) : null;
  } catch {
    return null;
  }
}

export function exportSqliteBinary(): Uint8Array | null {
  if (!dbInstance) return null;
  try {
    const bytes = dbInstance.export();
    lastKnownBytesLength = bytes.byteLength;
    return bytes;
  } catch {
    return null;
  }
}

export async function importSqliteBinary(bytes: Uint8Array): Promise<boolean> {
  if (!SQL) {
    await initSqliteDatabase();
  }
  if (!SQL) return false;
  try {
    const testDb = new SQL.Database(bytes);
    const check = testDb.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='products'");
    if (!check.length || !check[0].values.length) {
      testDb.close();
      return false;
    }
    createSchema(testDb);
    if (dbInstance) {
      try {
        dbInstance.close();
      } catch {
        // ignore
      }
    }
    dbInstance = testDb;
    lastKnownBytesLength = bytes.byteLength;
    await saveDbBytesToIdb(bytes);

    // Push restored SQLite tables directly into localStorage
    for (const { lsKey, table } of STORAGE_TO_TABLE) {
      const rows = readCollectionFromSqlite<any>(table);
      localStorage.setItem(lsKey, JSON.stringify(rows));
    }
    for (const key of KV_MIRROR_KEYS) {
      const val = getKvFromSqlite(key);
      if (val !== null) {
        localStorage.setItem(key, val);
      }
    }
    localStorage.setItem('bm_has_user_data_v1', 'true');
    setKvInSqlite('bm_has_user_data_v1', 'true', true);
    return true;
  } catch (err) {
    console.error('SQLite binary import failed:', err);
    return false;
  }
}

// ============================================================
// Local Image Cache inside SQLite
// ============================================================
export function getCachedImageFromSqlite(url: string): string | null {
  if (!dbInstance || !url) return null;
  try {
    const stmt = dbInstance.prepare('SELECT data_url FROM image_cache WHERE url = ?');
    stmt.bind([url]);
    let dataUrl: string | null = null;
    if (stmt.step()) {
      dataUrl = String(stmt.get()[0]);
    }
    stmt.free();
    return dataUrl;
  } catch {
    return null;
  }
}

export function saveCachedImageToSqlite(url: string, dataUrl: string, mimeType = 'image/jpeg'): void {
  if (!dbInstance || !url || !dataUrl) return;
  try {
    const sizeBytes = new Blob([dataUrl]).size;
    dbInstance.run(
      `INSERT OR REPLACE INTO image_cache (url, data_url, mime_type, size_bytes, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [url, dataUrl, mimeType, sizeBytes, new Date().toISOString()]
    );
    // Keep cache bounded to 120 images (evict oldest)
    dbInstance.run(
      `DELETE FROM image_cache WHERE url NOT IN (SELECT url FROM image_cache ORDER BY updated_at DESC LIMIT 120)`
    );
    scheduleSqlitePersist();
  } catch {
    // ignore
  }
}

// ============================================================
// Offline PIN Security Helpers (Local Unlock)
// ============================================================
async function hashPinWithSalt(uid: string, pin: string): Promise<string> {
  const input = `bm_pin_salt_v1:${uid}:${pin.trim()}`;
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const data = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Fallback FNV-1a mix if crypto.subtle unavailable
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fb_${(h >>> 0).toString(16)}`;
}

interface StoredOfflinePin {
  uid: string;
  hash: string;
  updatedAt: string;
}

export function hasOfflineUnlockPin(uid?: string): boolean {
  try {
    const raw = localStorage.getItem('bm_offline_pin_v1') || getKvFromSqlite('bm_offline_pin_v1');
    if (!raw) return false;
    const parsed = JSON.parse(raw) as StoredOfflinePin;
    if (!parsed || !parsed.hash) return false;
    return uid ? parsed.uid === uid : true;
  } catch {
    return false;
  }
}

export async function setOfflineUnlockPin(uid: string, pin: string): Promise<void> {
  const hash = await hashPinWithSalt(uid, pin);
  const record: StoredOfflinePin = {
    uid,
    hash,
    updatedAt: new Date().toISOString(),
  };
  const serialized = JSON.stringify(record);
  localStorage.setItem('bm_offline_pin_v1', serialized);
  setKvInSqlite('bm_offline_pin_v1', serialized, true);
}

export function clearOfflineUnlockPin(): void {
  localStorage.removeItem('bm_offline_pin_v1');
  setKvInSqlite('bm_offline_pin_v1', null, true);
}

export async function verifyOfflineUnlockPin(uid: string, pin: string): Promise<boolean> {
  try {
    const raw = localStorage.getItem('bm_offline_pin_v1') || getKvFromSqlite('bm_offline_pin_v1');
    if (!raw) return false;
    const parsed = JSON.parse(raw) as StoredOfflinePin;
    if (!parsed || parsed.uid !== uid) return false;
    const candidate = await hashPinWithSalt(uid, pin);
    return candidate === parsed.hash;
  } catch {
    return false;
  }
}

// ============================================================
// Diagnostics & Stats
// ============================================================
export function getSqliteStats(): SqliteStats {
  if (!dbInstance) {
    return {
      engine: 'SQLite (sql.js WASM)',
      initialized: false,
      dbSizeBytes: 0,
      pendingQueueCount: 0,
      snapshotCount: 0,
      cachedImageCount: 0,
      tableCounts: {},
      lastBackupAt: null,
    };
  }

  const tableCounts: Record<string, number> = {
    products: queryScalarNumber(dbInstance, 'SELECT COUNT(*) FROM products'),
    customers: queryScalarNumber(dbInstance, 'SELECT COUNT(*) FROM customers'),
    suppliers: queryScalarNumber(dbInstance, 'SELECT COUNT(*) FROM suppliers'),
    invoices: queryScalarNumber(dbInstance, 'SELECT COUNT(*) FROM invoices'),
    purchases: queryScalarNumber(dbInstance, 'SELECT COUNT(*) FROM purchases'),
    stock_movements: queryScalarNumber(dbInstance, 'SELECT COUNT(*) FROM stock_movements'),
    payments: queryScalarNumber(dbInstance, 'SELECT COUNT(*) FROM payments'),
    expenses: queryScalarNumber(dbInstance, 'SELECT COUNT(*) FROM expenses'),
  };

  const pendingQueueCount = queryScalarNumber(dbInstance, 'SELECT COUNT(*) FROM sync_queue');
  const snapshotCount = queryScalarNumber(dbInstance, 'SELECT COUNT(*) FROM db_snapshots');
  const cachedImageCount = queryScalarNumber(dbInstance, 'SELECT COUNT(*) FROM image_cache');

  let lastBackupAt: string | null = null;
  try {
    const res = dbInstance.exec('SELECT created_at FROM db_snapshots ORDER BY created_at DESC LIMIT 1');
    if (res.length && res[0].values.length) {
      lastBackupAt = String(res[0].values[0][0]);
    }
  } catch {
    // ignore
  }

  return {
    engine: 'SQLite (sql.js WASM)',
    initialized: true,
    dbSizeBytes: lastKnownBytesLength,
    pendingQueueCount,
    snapshotCount,
    cachedImageCount,
    tableCounts,
    lastBackupAt,
  };
}
