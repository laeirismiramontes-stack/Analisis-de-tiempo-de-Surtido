// Crea (o actualiza la contraseña de) un usuario del tablero de surtido.
// Solo lo puede llamar un admin de surtido_usuarios. La llave de servicio nunca sale del servidor.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Quién llama: debe tener sesión y ser admin del tablero.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: caller, error: callerErr } = await admin.auth.getUser(token);
  if (callerErr || !caller.user?.email) return json({ error: 'Sesión no válida. Vuelve a iniciar sesión.' }, 401);
  const { data: rolRow } = await admin
    .from('surtido_usuarios')
    .select('rol')
    .eq('email', caller.user.email.toLowerCase())
    .maybeSingle();
  if (rolRow?.rol !== 'admin') return json({ error: 'Solo un administrador puede crear usuarios.' }, 403);

  let body: { email?: string; password?: string; rol?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Solicitud inválida.' }, 400);
  }
  const email = (body.email ?? '').trim().toLowerCase();
  const password = body.password ?? '';
  const rol = body.rol === 'admin' ? 'admin' : 'lector';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Correo no válido.' }, 400);
  if (password.length < 8) return json({ error: 'La contraseña debe tener al menos 8 caracteres.' }, 400);

  // Crear la cuenta ya confirmada; si el correo ya existe, se le asigna la nueva contraseña.
  let creado = true;
  const { error: createErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createErr) {
    if (!/already|registered|exists/i.test(createErr.message)) return json({ error: createErr.message }, 400);
    creado = false;
    let userId: string | null = null;
    for (let page = 1; !userId && page <= 20; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) return json({ error: error.message }, 500);
      userId = data.users.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
      if (data.users.length < 200) break;
    }
    if (!userId) return json({ error: 'No se encontró la cuenta existente.' }, 500);
    const { error: updErr } = await admin.auth.admin.updateUserById(userId, { password, email_confirm: true });
    if (updErr) return json({ error: updErr.message }, 400);
  }

  const { error: rolErr } = await admin.from('surtido_usuarios').upsert({ email, rol });
  if (rolErr) return json({ error: rolErr.message }, 500);

  return json({ ok: true, creado });
});
