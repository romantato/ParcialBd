const API = '/api/clientes';
const TOKEN_KEY = 'aquamanager_token';

if (!localStorage.getItem(TOKEN_KEY)) {
  window.location.replace('/login.html');
}

function leerSesion() {
  try {
    const parte = localStorage.getItem(TOKEN_KEY).split('.')[1];
    const base64 = parte.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(base64), (caracter) => caracter.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

async function solicitar(url, opciones = {}) {
  const headers = new Headers(opciones.headers || {});
  const sesion = localStorage.getItem(TOKEN_KEY);
  if (sesion) headers.set('Authorization', `Bearer ${sesion}`);
  const respuesta = await fetch(url, { ...opciones, headers });
  if (respuesta.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    window.location.replace('/login.html');
  }
  return respuesta;
}

const els = {
  tabla: document.getElementById('tabla-clientes'),
  form: document.getElementById('form-cliente'),
  titulo: document.getElementById('form-titulo'),
  ayuda: document.getElementById('form-ayuda'),
  btnGuardar: document.getElementById('btn-guardar'),
  btnCancelar: document.getElementById('btn-cancelar'),
  busqueda: document.getElementById('busqueda'),
  banner: document.getElementById('banner'),
  metricTotal: document.getElementById('metric-total'),
  metricSemana: document.getElementById('metric-semana'),
  metricEnvases: document.getElementById('metric-envases'),
  nombre: document.getElementById('nombre'),
  alias: document.getElementById('alias'),
  direccion: document.getElementById('direccion'),
  tipoEnvase: document.getElementById('tipo_envase'),
};

let clientes = [];
let editandoId = null;

function inicioDeSemana() {
  const fecha = new Date();
  const dia = fecha.getDay();
  const diferencia = dia === 0 ? 6 : dia - 1;
  fecha.setHours(0, 0, 0, 0);
  fecha.setDate(fecha.getDate() - diferencia);
  return fecha;
}

function escapar(texto) {
  return String(texto ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function mostrarBanner(mensaje, tipo) {
  els.banner.textContent = mensaje;
  els.banner.className = tipo === 'error'
    ? 'mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700'
    : 'mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700';
  window.clearTimeout(mostrarBanner.timer);
  mostrarBanner.timer = window.setTimeout(() => {
    els.banner.className = 'mb-4 hidden rounded-xl border px-4 py-3 text-sm';
  }, 3500);
}

function actualizarMetricas() {
  const inicio = inicioDeSemana();
  const nuevos = clientes.filter((cliente) => new Date(cliente.created_at) >= inicio).length;
  const envases = new Set(clientes.map((cliente) => cliente.tipo_envase)).size;

  els.metricTotal.textContent = String(clientes.length);
  els.metricSemana.textContent = String(nuevos);
  els.metricEnvases.textContent = String(envases);
}

function clientesVisibles() {
  const termino = els.busqueda.value.trim().toLowerCase();
  if (!termino) return clientes;
  return clientes.filter((cliente) => {
    const nombre = (cliente.nombre || '').toLowerCase();
    const alias = (cliente.alias || '').toLowerCase();
    const direccion = (cliente.direccion || '').toLowerCase();
    return nombre.includes(termino) || alias.includes(termino) || direccion.includes(termino);
  });
}

function renderTabla() {
  const lista = clientesVisibles();

  if (!lista.length) {
    const vacio = clientes.length
      ? 'Ningún cliente coincide con la búsqueda.'
      : 'Aún no hay clientes. Registra el primero en el formulario.';
    els.tabla.innerHTML = `<tr><td colspan="4" class="px-5 py-10 text-center text-sm text-slate-400">${vacio}</td></tr>`;
    return;
  }

  els.tabla.innerHTML = lista.map((cliente) => `
    <tr class="align-top hover:bg-slate-50/80">
      <td class="px-5 py-4">
        <p class="font-medium text-slate-900">${escapar(cliente.nombre)}</p>
        <p class="text-xs text-slate-400">${cliente.alias ? escapar(cliente.alias) : 'Sin alias'}</p>
      </td>
      <td class="max-w-xs px-5 py-4 text-slate-600">${escapar(cliente.direccion)}</td>
      <td class="px-5 py-4">
        <span class="inline-flex rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">${escapar(cliente.tipo_envase)}</span>
      </td>
      <td class="px-5 py-4 text-right">
        <button type="button" data-accion="editar" data-id="${escapar(cliente.id)}" class="mr-2 text-sm font-medium text-sky-700 hover:text-sky-900">Editar</button>
        <button type="button" data-accion="eliminar" data-id="${escapar(cliente.id)}" class="text-sm font-medium text-rose-600 hover:text-rose-800">Eliminar</button>
      </td>
    </tr>
  `).join('');
}

function pintar() {
  actualizarMetricas();
  renderTabla();
}

async function cargarClientes() {
  const respuesta = await solicitar(API);
  const data = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    throw new Error(data.error || 'No se pudieron cargar los clientes');
  }
  clientes = data;
  pintar();
}

function leerFormulario() {
  return {
    nombre: els.nombre.value.trim(),
    alias: els.alias.value.trim(),
    direccion: els.direccion.value.trim(),
    tipo_envase: els.tipoEnvase.value,
  };
}

function modoCreacion() {
  editandoId = null;
  els.form.reset();
  els.titulo.textContent = 'Nuevo cliente';
  els.ayuda.textContent = 'Registra un punto de entrega para la ruta.';
  els.btnGuardar.textContent = 'Registrar cliente';
  els.btnCancelar.classList.add('hidden');
}

function modoEdicion(cliente) {
  editandoId = cliente.id;
  els.nombre.value = cliente.nombre || '';
  els.alias.value = cliente.alias || '';
  els.direccion.value = cliente.direccion || '';
  els.tipoEnvase.value = cliente.tipo_envase || '';
  els.titulo.textContent = 'Editar cliente';
  els.ayuda.textContent = 'Actualiza los datos y guarda los cambios.';
  els.btnGuardar.textContent = 'Guardar cambios';
  els.btnCancelar.classList.remove('hidden');
  els.nombre.focus();
}

els.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = leerFormulario();
  els.btnGuardar.disabled = true;

  try {
    const respuesta = await solicitar(editandoId ? `${API}/${editandoId}` : API, {
      method: editandoId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) {
      throw new Error(data.error || 'No se pudo guardar el cliente');
    }

    mostrarBanner(editandoId ? 'Cliente actualizado.' : 'Cliente registrado.', 'ok');
    modoCreacion();
    await cargarClientes();
  } catch (err) {
    mostrarBanner(err.message, 'error');
  } finally {
    els.btnGuardar.disabled = false;
  }
});

els.btnCancelar.addEventListener('click', modoCreacion);
els.busqueda.addEventListener('input', renderTabla);

els.tabla.addEventListener('click', async (event) => {
  const boton = event.target.closest('button[data-accion]');
  if (!boton) return;

  const cliente = clientes.find((item) => item.id === boton.dataset.id);
  if (!cliente) return;

  if (boton.dataset.accion === 'editar') {
    modoEdicion(cliente);
    return;
  }

  const confirmar = window.confirm(`¿Eliminar a ${cliente.nombre}?`);
  if (!confirmar) return;

  try {
    const respuesta = await solicitar(`${API}/${cliente.id}`, { method: 'DELETE' });
    const data = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) {
      throw new Error(data.error || 'No se pudo eliminar el cliente');
    }
    if (editandoId === cliente.id) modoCreacion();
    mostrarBanner('Cliente eliminado.', 'ok');
    await cargarClientes();
  } catch (err) {
    mostrarBanner(err.message, 'error');
  }
});

const sesion = leerSesion();
if (sesion) {
  document.getElementById('usuario-nombre').textContent = sesion.nombre || sesion.correo;
  document.getElementById('usuario-rol').textContent = sesion.rol || '';
}
document.getElementById('btn-salir').addEventListener('click', () => {
  localStorage.removeItem(TOKEN_KEY);
  window.location.replace('/login.html');
});

const panelReportes = document.getElementById('panel-reportes');
const botonReportes = document.getElementById('btn-reportes');
const navClientes = document.getElementById('nav-clientes');
const claseNavActiva = 'flex items-center gap-3 rounded-lg bg-sky-500/15 px-3 py-2.5 text-sm font-medium text-sky-300 ring-1 ring-inset ring-sky-400/30';
const claseNavInactiva = 'mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-300 hover:bg-slate-800';

botonReportes.addEventListener('click', () => {
  panelReportes.classList.remove('hidden');
  botonReportes.className = `mt-1 w-full text-left ${claseNavActiva}`;
  navClientes.className = 'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-800';
  panelReportes.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

navClientes.addEventListener('click', () => {
  navClientes.className = claseNavActiva;
  botonReportes.className = claseNavInactiva;
});

async function descargarReporte(url, nombreRespaldo, boton) {
  boton.disabled = true;
  try {
    const respuesta = await solicitar(url);
    if (respuesta.status === 401) return;
    if (!respuesta.ok) {
      const data = await respuesta.json().catch(() => ({}));
      throw new Error(data.error || 'No se pudo generar el reporte');
    }
    const blob = await respuesta.blob();
    const disposition = respuesta.headers.get('Content-Disposition') || '';
    const coincidencia = disposition.match(/filename="([^"]+)"/);
    const enlace = document.createElement('a');
    const objectUrl = URL.createObjectURL(blob);
    enlace.href = objectUrl;
    enlace.download = coincidencia?.[1] || nombreRespaldo;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    URL.revokeObjectURL(objectUrl);
  } catch (err) {
    mostrarBanner(err.message, 'error');
  } finally {
    boton.disabled = false;
  }
}

document.getElementById('btn-pdf').addEventListener('click', (event) => {
  descargarReporte('/api/reportes/clientes/pdf', 'reporte-clientes.pdf', event.currentTarget);
});

document.getElementById('btn-excel').addEventListener('click', (event) => {
  descargarReporte('/api/reportes/clientes/excel', 'reporte-clientes.xlsx', event.currentTarget);
});

document.getElementById('btn-pdf-ventas').addEventListener('click', (event) => {
  descargarReporte('/api/reportes/ventas/pdf', 'reporte-ventas.pdf', event.currentTarget);
});

document.getElementById('btn-excel-ventas').addEventListener('click', (event) => {
  descargarReporte('/api/reportes/ventas/excel', 'reporte-ventas.xlsx', event.currentTarget);
});

cargarClientes().catch((err) => {
  els.tabla.innerHTML = `<tr><td colspan="4" class="px-5 py-10 text-center text-sm text-rose-500">${escapar(err.message)}</td></tr>`;
  mostrarBanner(err.message, 'error');
});
