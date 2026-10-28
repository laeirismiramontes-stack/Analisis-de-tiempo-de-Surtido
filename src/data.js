// Lectura del reporte ZTPOENT (Excel) y almacenamiento en Supabase.
import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_KEY);

const UPSERT_CHUNK = 1000;

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

const check = ({ data, error }) => {
  if (error) throw new Error(error.message);
  return data;
};

// Rol del usuario en sesión: 'admin', 'lector' o null si no está autorizado.
export async function currentRole(email) {
  const rows = check(await supabase.from('usuarios_autorizados').select('rol').eq('email', email.toLowerCase()));
  return rows[0]?.rol ?? null;
}

export async function loadStored() {
  const rows = check(await supabase.rpc('obtener_registros')) || [];
  const records = rows.map(([id, date, hour, who, user, plazo, min]) => ({ id, date, hour, who, user, plazo, min: Number(min) }));
  const cargas = check(await supabase.from('cargas').select('*').order('creado_en', { ascending: false }).limit(1));
  const c = cargas[0];
  const meta = c ? { lastLoad: c.creado_en, fileName: c.archivo, added: c.nuevos, updated: c.actualizados, by: c.cargado_por } : null;
  return { records, meta };
}

// Sube los registros del archivo (insertando o actualizando por folio) y registra la carga.
export async function saveIncoming(incoming, existingIds, fileName, onProgress) {
  const added = incoming.filter((r) => !existingIds.has(r.id)).length;
  const rows = [...new Map(incoming.map((r) => [r.id, r])).values()].map((r) => ({
    folio_entrega: r.id, fecha: r.date, hora: r.hour, colaborador: r.who, usuario_sap: r.user, plazo: r.plazo, minutos: r.min,
    actualizado_en: new Date().toISOString(),
  }));
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    check(await supabase.from('registros_surtido').upsert(rows.slice(i, i + UPSERT_CHUNK), { onConflict: 'folio_entrega' }));
    onProgress?.(Math.min(i + UPSERT_CHUNK, rows.length), rows.length);
  }
  check(await supabase.from('cargas').insert({ archivo: fileName, registros: rows.length, nuevos: added, actualizados: rows.length - added }));
  return { added, updated: rows.length - added };
}

export const listUsers = async () =>
  check(await supabase.from('usuarios_autorizados').select('*').order('creado_en'));

export const addUser = async (email, rol) =>
  check(await supabase.from('usuarios_autorizados').upsert({ email: email.trim().toLowerCase(), rol }));

export const removeUser = async (email) =>
  check(await supabase.from('usuarios_autorizados').delete().eq('email', email));

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
