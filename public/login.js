const TOKEN_KEY = 'aquamanager_token';
const banner = document.getElementById('banner');
const form = document.getElementById('form-login');
const boton = document.getElementById('btn-entrar');

function mostrar(mensaje, tipo) {
  banner.textContent = mensaje;
  banner.className = tipo === 'error'
    ? 'mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700'
    : 'mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700';
}

if (new URLSearchParams(location.search).get('restablecida') === '1') {
  mostrar('Tu contraseña fue actualizada. Ya puedes iniciar sesión.', 'ok');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  boton.disabled = true;

  try {
    const respuesta = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        correo: document.getElementById('correo').value.trim(),
        password: document.getElementById('password').value,
      }),
    });
    const data = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) throw new Error(data.error || 'No se pudo iniciar sesión');

    localStorage.setItem(TOKEN_KEY, data.token);
    window.location.replace('/');
  } catch (err) {
    mostrar(err.message, 'error');
    boton.disabled = false;
  }
});
