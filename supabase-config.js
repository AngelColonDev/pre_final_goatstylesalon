// Conexion con Supabase.
// Mientras url o anonKey esten vacios, el sitio funciona igual que antes (datos en el navegador).
// Cuando los llenes, supabase-sync.js empieza a leer y guardar en Supabase.
//   url:     Supabase → Project Settings → API → Project URL
//   anonKey: Supabase → Project Settings → API → anon / publishable key
// La anon key es pública por diseño (la seguridad la dan las políticas RLS de supabase/schema.sql).
// NUNCA pongas aquí la service_role key.
window.GABY_SUPABASE = {
    url: '',
    anonKey: ''
};
