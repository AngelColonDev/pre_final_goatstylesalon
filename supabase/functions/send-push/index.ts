// ===========================================================================
// Edge Function: send-push
// Envía notificaciones push (Firebase Cloud Messaging) a los dispositivos
// registrados en public.push_tokens.
//
// Modos (POST con JSON):
//   { "mode": "send", "notificationId": "ntf-..." }
//       Envía un aviso que ya existe en public.notifications a los dispositivos
//       que le corresponden: si es de cliente, a los tokens con su código de
//       cita; si es del personal, a los tokens de ese barbero (o a todos los del
//       personal si no tiene barbero asignado).
//   { "mode": "reminders" }
//       Barrido de recordatorios (para pg_cron cada 15 minutos): crea el aviso
//       de 24 h y el de 1 h para las citas APROBADA/PENDIENTE que los necesiten
//       y los envía por push. Usa las mismas reglas que notifications.js, para
//       no duplicar avisos: marca reminder_sent_at / reminder_1h_sent_at y
//       comprueba que el aviso no exista ya.
//
// Despliegue (desde la raíz del repo, con Supabase CLI y el proyecto creado):
//   supabase functions deploy send-push --no-verify-jwt
//   supabase secrets set FCM_SERVICE_ACCOUNT_JSON='<contenido de la clave JSON
//     de la cuenta de servicio de Firebase>'
//   supabase secrets set SUPABASE_URL='https://<proyecto>.supabase.co'
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY='<service_role key>'
// La clave de servicio de Firebase y la service_role NUNCA van en el código
// de la página ni en este archivo: solo como secretos del proyecto.
// Para el barrido, programa pg_cron (Dashboard → Database → Cron Jobs) con:
//   select net.http_post(
//     url := 'https://<proyecto>.supabase.co/functions/v1/send-push',
//     headers := '{"Content-Type": "application/json", "Authorization": "Bearer <service_role key>"}'::jsonb,
//     body := '{"mode": "reminders"}'::jsonb);
// cada 15 minutos.
// ===========================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import admin from 'npm:firebase-admin@12.7.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function serviceAccount() {
  const raw = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON') || '';
  if (!raw) throw new Error('Falta el secreto FCM_SERVICE_ACCOUNT_JSON.');
  return JSON.parse(raw);
}

let app: admin.app.App | null = null;
function messaging() {
  if (!app) app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount()) });
  return admin.messaging(app);
}

// Envía a un token y dice si sigue válido (FCM rechaza los viejos con 404/410).
async function sendToToken(token: string, title: string, body: string, data: Record<string, string>) {
  try {
    await messaging().send({ token, notification: { title, body }, data });
    return { ok: true, invalid: false };
  } catch (error) {
    const code = (error as { code?: string })?.code || '';
    return { ok: false, invalid: code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token' };
  }
}

async function sendToTokens(
  supabase: ReturnType<typeof createClient>,
  tokens: { id: string; endpoint: string }[],
  title: string,
  body: string,
  data: Record<string, string>,
) {
  let sent = 0;
  const invalidIds: string[] = [];
  for (const token of tokens) {
    const result = await sendToToken(token.endpoint, title, body, data);
    if (result.ok) sent += 1;
    else if (result.invalid) invalidIds.push(token.id);
  }
  if (invalidIds.length) {
    await supabase.from('push_tokens').delete().in('id', invalidIds);
  }
  return { sent, invalid: invalidIds.length };
}

async function tokensForNotification(
  supabase: ReturnType<typeof createClient>,
  note: { audience: string; barber_id: string | null; appointment_code: string | null },
) {
  if (note.audience === 'client' && note.appointment_code) {
    const { data } = await supabase
      .from('push_tokens')
      .select('id, endpoint')
      .contains('appointment_codes', [note.appointment_code]);
    return data || [];
  }
  // Aviso del personal: al barbero asignado, o a todo el personal si no tiene.
  let query = supabase.from('push_tokens').select('id, endpoint').not('barber_id', 'is', null);
  if (note.barber_id) query = query.eq('barber_id', note.barber_id);
  const { data } = await query;
  return data || [];
}

async function sendOne(supabase: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  const id = body.notificationId;
  if (typeof id !== 'string' || !id) return json({ error: 'Falta notificationId.' }, 400);
  const { data: note, error } = await supabase.from('notifications').select('*').eq('id', id).maybeSingle();
  if (error || !note) return json({ error: 'Aviso no encontrado.' }, 404);
  const tokens = await tokensForNotification(supabase, note);
  if (!tokens.length) return json({ sent: 0, note: 'Sin dispositivos registrados para este aviso.' });
  const result = await sendToTokens(supabase, tokens, note.title, note.body, {
    id: note.id,
    code: note.appointment_code || '',
    type: note.type || '',
    url: 'notificaciones.html',
    tag: `goat-${note.id}`,
  });
  return json({ sent: result.sent, invalid: result.invalid });
}

async function sendReminders(supabase: ReturnType<typeof createClient>) {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 3600000).toISOString();
  const in1h = new Date(now.getTime() + 1 * 3600000).toISOString();
  const { data: appointments, error } = await supabase
    .from('appointments')
    .select('code, client_id, client_name, service, barber_id, barber_name, date_time, reminder_sent_at, reminder_1h_sent_at')
    .in('status', ['PENDIENTE', 'APROBADA'])
    .gte('date_time', now.toISOString())
    .lte('date_time', in24h);
  if (error) return json({ error: error.message }, 500);
  let created = 0;
  let sent = 0;
  for (const appt of appointments || []) {
    const start = new Date(appt.date_time).getTime();
    const jobs: { type: string; field: string; title: string }[] = [];
    if (start <= new Date(in24h).getTime() && !appt.reminder_sent_at) {
      jobs.push({ type: 'recordatorio-24h', field: 'reminder_sent_at', title: 'Recordatorio de tu cita' });
    }
    if (start <= new Date(in1h).getTime() && !appt.reminder_1h_sent_at) {
      jobs.push({ type: 'recordatorio-1h', field: 'reminder_1h_sent_at', title: 'Tu cita es en 1 hora' });
    }
    for (const job of jobs) {
      // No duplicar: si el aviso ya existe (lo creó el barrido local), no se crea otro.
      const { data: existing } = await supabase
        .from('notifications')
        .select('id')
        .eq('appointment_code', appt.code)
        .eq('type', job.type)
        .limit(1);
      if (existing && existing.length) continue;
      const body = `${appt.service} con ${appt.barber_name || ''} · ${new Date(appt.date_time).toLocaleString('es-PR', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`;
      const { data: note, error: insertError } = await supabase
        .from('notifications')
        .insert({
          id: `ntf-${crypto.randomUUID()}`,
          audience: 'client',
          client_id: appt.client_id,
          type: job.type,
          title: job.title,
          body,
          appointment_code: appt.code,
        })
        .select('id')
        .single();
      if (insertError || !note) continue;
      await supabase.from('appointments').update({ [job.field]: now.toISOString() }).eq('code', appt.code);
      created += 1;
      const tokens = await tokensForNotification(supabase, {
        audience: 'client',
        barber_id: null,
        appointment_code: appt.code,
      });
      const result = await sendToTokens(supabase, tokens, job.title, body, {
        id: note.id,
        code: appt.code,
        type: job.type,
        url: 'notificaciones.html',
        tag: `goat-${note.id}`,
      });
      sent += result.sent;
    }
  }
  return json({ created, sent });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
    );
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.mode === 'reminders') return await sendReminders(supabase);
    return await sendOne(supabase, body);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Error inesperado.' }, 500);
  }
});
