/* Capa de datos con Supabase. Debe cargarse después de supabase-js y antes del script principal. */

// Entornos. La anon key es pública (se envía al navegador), pero no pongas claves service_role aquí.
const ENTORNOS = {
  staging: {
    url: 'https://gtnxlkqumppeintdpycn.supabase.co',
    key: 'PEGAR_ANON_KEY_STAGING' // Project Settings > API del proyecto de pruebas
  },
  prod: {
    url: 'PENDIENTE_URL_PROD',
    key: 'PENDIENTE_KEY_PROD'
  }
};

// Dominios donde corre producción. Cualquier otro host (localhost, previews) usa staging.
const HOSTS_PRODUCCION = ['www.matchempleos.com']; // completar con el dominio real

const ENTORNO = HOSTS_PRODUCCION.includes(location.hostname) ? 'prod' : 'staging';
console.info('[db] entorno:', ENTORNO);

const sb = supabase.createClient(ENTORNOS[ENTORNO].url, ENTORNOS[ENTORNO].key);

// Identidad de demo hasta tener autenticación
const ME = { candidato: 'tomas', empresa: 'cafe' };

// Ejecuta una escritura y avisa si falla, sin romper la UI
function persistir(query, etiqueta){
  return query.then(({ data, error }) => {
    if (error) throw error;
    return data;
  }).catch(err => {
    console.error('[db] ' + etiqueta, err);
    document.dispatchEvent(new CustomEvent('db-error', { detail: etiqueta }));
    return null;
  });
}

// Sin métodos internos del objeto de chat (typing, contador)
function chatMeta(c){
  const { msgs, typing, n, ...meta } = c;
  return meta;
}

const DB = {
  cargar(){
    return Promise.all([
      sb.from('perfiles').select('*'),
      sb.from('postulaciones').select('*').eq('candidato_id', ME.candidato).order('created_at', { ascending: false }),
      sb.from('busquedas').select('*').eq('empresa_id', ME.empresa).order('created_at', { ascending: false }),
      sb.from('candidatos_estado').select('*').eq('empresa_id', ME.empresa),
      sb.from('mensajes').select('*').order('id', { ascending: true }),
    ]).then(res => {
      const err = res.find(r => r.error);
      if (err) throw err.error;
      const [perfiles, postulaciones, busquedas, candidatosEstado, mensajes] = res.map(r => r.data);
      return { perfiles, postulaciones, busquedas, candidatosEstado, mensajes };
    });
  },

  // Create o Update según exista el id
  guardarPostulacion(post, oid, chat){
    return persistir(sb.from('postulaciones').upsert({
      id: post.id, candidato_id: ME.candidato, oferta_id: oid,
      estado: post.estado, datos: { post, chat: chat || null }, updated_at: new Date().toISOString()
    }), 'guardarPostulacion');
  },

  setCupo(cupo){
    return persistir(sb.from('perfiles').update({ cupo }).eq('id', ME.candidato), 'setCupo');
  },

  guardarBusqueda(b){
    return persistir(sb.from('busquedas').upsert({
      id: b.id, empresa_id: ME.empresa, puesto: b.puesto,
      descripcion: b.desc || null, total: b.total, estado: b.estado
    }), 'guardarBusqueda');
  },

  guardarCandidato(id, corto, estado){
    return persistir(sb.from('candidatos_estado').upsert({
      id, empresa_id: ME.empresa, corto, estado, updated_at: new Date().toISOString()
    }), 'guardarCandidato');
  },

  setTasa(tasa){
    return persistir(sb.from('perfiles').update({ tasa }).eq('id', ME.empresa), 'setTasa');
  },

  nuevoMensaje(chatKey, de, texto, h){
    return persistir(sb.from('mensajes').insert({ chat_key: chatKey, de, texto, h }), 'nuevoMensaje');
  }
};
