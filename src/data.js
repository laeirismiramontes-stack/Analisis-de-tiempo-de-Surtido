// Lectura del reporte ZTPOENT (Excel) y almacenamiento local en IndexedDB.
import * as XLSX from 'xlsx';

const DB_NAME = 'surtido-db';
const STORE = 'kv';

const COLS = {
  fecha: 'Fecha del Pedido/Ticket',
  horaPedido: 'Hora del Pedido',
  horaPago: 'Hora del Pago',
  horaSalida: 'Hora de Salida Material',
  usuario: 'Usuario Responsable Salida Material',
  nombre: 'Nombre del Colaborador',
  plazo: 'Plazo de Entrega',
  minutos: 'Tpo Entr Minutos',
  entrega: 'Folio de Entrega',
  pedido: 'Folio de Pedido/Ticket',
};

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
  });
}

export const loadStored = async () => ({
  records: (await idb('readonly', (s) => s.get('records'))) || [],
  meta: (await idb('readonly', (s) => s.get('meta'))) || null,
});

export const saveStored = (records, meta) =>
  idb('readwrite', (s) => {
    s.put(records, 'records');
    s.put(meta, 'meta');
  });

export const clearStored = () => idb('readwrite', (s) => s.clear());

// Convierte un serial de Excel (días desde 1899-12-30) en fecha local sin desfase de zona horaria.
function serialToParts(serial) {
  const days = Math.floor(serial);
  const d = new Date(Date.UTC(1899, 11, 30) + days * 86400000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

const pad = (n) => String(n).padStart(2, '0');

function toSerial(v) {
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime() / 86400000 + 25569;
  if (typeof v === 'string') {
    // Formatos dd.mm.yyyy / dd/mm/yyyy y hh:mm:ss
    let m = v.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
    if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1]) / 86400000 + 25569;
    m = v.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (m) return (+m[1] * 3600 + +m[2] * 60 + +(m[3] || 0)) / 86400;
  }
  return null;
}

// Parsea el archivo y devuelve registros compactos.
export async function parseFile(file) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
  if (!rows.length || !(COLS.minutos in rows[0]) || !(COLS.fecha in rows[0])) {
    throw new Error('El archivo no tiene el formato del reporte ZTPOENT (faltan columnas esperadas).');
  }
  const out = [];
  for (const r of rows) {
    const fecha = toSerial(r[COLS.fecha]);
    const pago = toSerial(r[COLS.horaPago]);
    const min = Number(r[COLS.minutos]);
    if (fecha == null || !Number.isFinite(min)) continue;
    const p = serialToParts(fecha);
    const horaRef = pago ?? toSerial(r[COLS.horaPedido]) ?? 0;
    const usuario = String(r[COLS.usuario] ?? '').trim();
    out.push({
      id: String(r[COLS.entrega] ?? r[COLS.pedido] ?? `${fecha}-${horaRef}-${usuario}`),
      date: `${p.y}-${pad(p.m)}-${pad(p.d)}`,
      hour: Math.floor((horaRef % 1) * 24 + 1e-9),
      who: String(r[COLS.nombre] ?? '').trim() || usuario || 'SIN NOMBRE',
      user: usuario,
      plazo: String(r[COLS.plazo] ?? '').trim(),
      min,
    });
  }
  return out;
}

// Une registros nuevos con los existentes usando el folio de entrega como llave.
export function mergeRecords(existing, incoming) {
  const map = new Map(existing.map((r) => [r.id, r]));
  let added = 0;
  for (const r of incoming) {
    if (!map.has(r.id)) added++;
    map.set(r.id, r);
  }
  const records = [...map.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.hour - b.hour));
  return { records, added, updated: incoming.length - added };
}
