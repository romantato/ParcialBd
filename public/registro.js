const banner = document.getElementById('banner');
const form = document.getElementById('form-registro');
const boton = document.getElementById('btn-crear');

function mostrar(mensaje) {
  banner.textContent = mensaje;
  banner.className = 'mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700';
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  boton.disabled = true;

  try {
    const respuesta = await fetch('/api/auth/registro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: document.getElementById('nombre').value.trim(),
        correo: document.getElementById('correo').value.trim(),
        password: document.getElementById('password').value,
        confirmacion: document.getElementById('confirmacion').value,
      }),
    });
    const data = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) throw new Error(data.error || 'No se pudo crear la cuenta');

    localStorage.setItem('aquamanager_token', data.token);
    window.location.replace('/');
  } catch (err) {
    mostrar(err.message);
    boton.disabled = false;
  }
});
