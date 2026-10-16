const params = new URLSearchParams(location.search);
const token = params.get('token') || '';
const form = document.getElementById('form-restablecer');
const boton = document.getElementById('btn-guardar');
const banner = document.getElementById('banner');
const titulo = document.getElementById('titulo');
const ayuda = document.getElementById('ayuda');

const estilos = {
  pendiente: 'rounded-xl border border-slate-200 px-2 py-2 text-slate-500',
  actual: 'rounded-xl border border-sky-300 bg-sky-50 px-2 py-2 font-medium text-sky-800',
  listo: 'rounded-xl border border-emerald-200 bg-emerald-50 px-2 py-2 font-medium text-emerald-800',
};

function pintarPasos(listos, actual) {
  document.querySelectorAll('[data-paso]').forEach((paso) => {
    const numero = Number(paso.dataset.paso);
    if (listos.includes(numero)) paso.className = estilos.listo;
    else if (numero === actual) paso.className = estilos.actual;
    else paso.className = estilos.pendiente;
  });
}

function mostrar(mensaje, tipo) {
  banner.textContent = mensaje;
  banner.className = tipo === 'error'
    ? 'mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700'
    : 'mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700';
}

async function validarEnlace() {
  if (!token) {
    form.classList.add('hidden');
    pintarPasos([], 6);
    mostrar('El enlace de recuperación no es válido.', 'error');
    return;
  }

  pintarPasos([6], 7);
  const respuesta = await fetch(`/api/auth/recuperar/validar?token=${encodeURIComponent(token)}`);
  const data = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    form.classList.add('hidden');
    mostrar(data.error || 'El enlace no es válido.', 'error');
    return;
  }

  titulo.textContent = data.nombre ? `Hola, ${data.nombre}` : 'Crea tu nueva contraseña';
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  boton.disabled = true;

  try {
    const respuesta = await fetch('/api/auth/restablecer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        password: document.getElementById('password').value,
        confirmacion: document.getElementById('confirmacion').value,
      }),
    });
    const data = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) throw new Error(data.error || 'No se pudo actualizar la contraseña');

    pintarPasos([6, 7, 8], 0);
    form.classList.add('hidden');
    titulo.textContent = 'Contraseña actualizada';
    ayuda.textContent = 'La base de datos ya tiene la nueva clave y el token quedó desactivado.';
    mostrar('Listo. Te llevamos al inicio de sesión.', 'ok');
    window.setTimeout(() => {
      window.location.replace('/login.html?restablecida=1');
    }, 1600);
  } catch (err) {
    mostrar(err.message, 'error');
    boton.disabled = false;
  }
});

validarEnlace().catch(() => {
  form.classList.add('hidden');
  mostrar('No se pudo validar el enlace.', 'error');
});
