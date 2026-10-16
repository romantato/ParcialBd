const form = document.getElementById('form-recuperar');
const boton = document.getElementById('btn-enviar');
const banner = document.getElementById('banner');
const aviso = document.getElementById('aviso-correo');
const avisoDetalle = document.getElementById('aviso-detalle');

const estilos = {
  pendiente: 'rounded-2xl border border-slate-200 bg-white p-4',
  actual: 'rounded-2xl border border-sky-300 bg-sky-50 p-4 ring-1 ring-sky-200',
  listo: 'rounded-2xl border border-emerald-200 bg-emerald-50 p-4',
  error: 'rounded-2xl border border-rose-200 bg-rose-50 p-4',
};

function pintarPasos({ listos = [], actual = 0, error = 0 }) {
  document.querySelectorAll('[data-paso]').forEach((paso) => {
    const numero = Number(paso.dataset.paso);
    if (numero === error) paso.className = estilos.error;
    else if (listos.includes(numero)) paso.className = estilos.listo;
    else if (numero === actual) paso.className = estilos.actual;
    else paso.className = estilos.pendiente;
  });
}

function mostrarError(mensaje) {
  banner.textContent = mensaje;
  banner.className = 'mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700';
}

pintarPasos({ listos: [1], actual: 2 });

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  banner.className = 'mt-4 hidden rounded-xl border px-4 py-3 text-sm';
  boton.disabled = true;
  pintarPasos({ listos: [1], actual: 3 });

  try {
    const respuesta = await fetch('/api/auth/recuperar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correo: document.getElementById('correo').value.trim() }),
    });
    const data = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) {
      pintarPasos({ listos: [1, 2], actual: 3, error: 3 });
      throw new Error(data.error || 'No se pudo enviar el correo');
    }

    pintarPasos({ listos: [1, 2, 3, 4, 5], actual: 6 });
    form.classList.add('hidden');
    document.getElementById('form-titulo').textContent = 'Correo enviado';
    document.getElementById('form-ayuda').textContent = 'Abre el enlace del mensaje para continuar con la nueva contraseña.';
    avisoDetalle.textContent = `Enviamos el enlace a ${data.correo}. Es válido por ${data.expiraEnMinutos} minutos y deja de funcionar después de usarse.`;
    aviso.classList.remove('hidden');
  } catch (err) {
    mostrarError(err.message);
    boton.disabled = false;
  }
});
