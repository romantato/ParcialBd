const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const TOKEN_MINUTOS = 30;
const intentosRecuperacion = new Map();

function transporter() {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
}

function correoValido(valor) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor);
}

function normalizarCorreo(valor) {
  return String(valor || '').trim().toLowerCase();
}

function escaparHtml(texto) {
  return String(texto || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function firmar(usuario) {
  return jwt.sign(
    {
      id: usuario.id,
      nombre: usuario.nombre,
      correo: usuario.correo,
      rol: usuario.rol,
    },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );
}

function usuarioPublico(usuario) {
  return {
    id: usuario.id,
    nombre: usuario.nombre,
    correo: usuario.correo,
    rol: usuario.rol,
  };
}

function requireAuth(req, res, next) {
  const encabezado = req.headers.authorization || '';
  const token = encabezado.startsWith('Bearer ') ? encabezado.slice(7) : '';
  if (!token || !process.env.JWT_SECRET) {
    return res.status(401).json({ error: 'Debes iniciar sesión' });
  }

  try {
    req.usuario = jwt.verify(token, process.env.JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }
}

function limitado(correo) {
  const ahora = Date.now();
  const recientes = (intentosRecuperacion.get(correo) || []).filter((marca) => ahora - marca < 15 * 60 * 1000);
  if (recientes.length >= 5) {
    intentosRecuperacion.set(correo, recientes);
    return true;
  }
  recientes.push(ahora);
  intentosRecuperacion.set(correo, recientes);
  return false;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function buscarUsuarioPorCorreo(pool, correo) {
  const { rows } = await pool.query(
    `SELECT id, nombre, correo, password_hash, rol
     FROM usuarios
     WHERE lower(correo) = lower($1)`,
    [correo]
  );
  return rows[0] || null;
}

async function buscarToken(pool, token) {
  const { rows } = await pool.query(
    `SELECT t.id, t.usuario_id, t.usado, t.fecha_expiracion > current_timestamp() AS vigente,
            u.nombre, u.correo
     FROM tokens_recuperacion t
     JOIN usuarios u ON u.id = t.usuario_id
     WHERE t.token = $1`,
    [hashToken(token)]
  );
  return rows[0] || null;
}

function validarPassword(password, confirmacion) {
  const clave = String(password || '');
  if (clave.length < 8) {
    return 'La contraseña debe tener al menos 8 caracteres';
  }
  if (confirmacion !== undefined && clave !== String(confirmacion || '')) {
    return 'Las contraseñas no coinciden';
  }
  return '';
}

async function initAuth(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id BIGINT PRIMARY KEY DEFAULT unique_rowid(),
      nombre VARCHAR(150) NOT NULL,
      correo VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      rol VARCHAR(30) NOT NULL DEFAULT 'Repartidor',
      fecha_creacion TIMESTAMP DEFAULT current_timestamp(),
      CONSTRAINT check_rol CHECK (rol IN ('Administrador', 'Repartidor'))
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tokens_recuperacion (
      id BIGINT PRIMARY KEY DEFAULT unique_rowid(),
      usuario_id BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      token VARCHAR(128) NOT NULL UNIQUE,
      fecha_expiracion TIMESTAMP NOT NULL,
      usado BOOLEAN NOT NULL DEFAULT false
    )
  `);
}

function registrarAuth(app, pool) {
  app.post('/api/auth/registro', async (req, res) => {
    const nombre = String(req.body?.nombre || '').trim();
    const correo = normalizarCorreo(req.body?.correo);
    const password = String(req.body?.password || '');
    const confirmacion = String(req.body?.confirmacion || '');
    const rol = 'Repartidor';
    const errorClave = validarPassword(password, confirmacion);

    if (!nombre || !correo || !password) {
      return res.status(400).json({ error: 'nombre, correo y contraseña son obligatorios' });
    }
    if (!correoValido(correo)) {
      return res.status(400).json({ error: 'Ingresa un correo válido' });
    }
    if (errorClave) {
      return res.status(400).json({ error: errorClave });
    }

    try {
      const existente = await buscarUsuarioPorCorreo(pool, correo);
      if (existente) {
        return res.status(409).json({ error: 'Ese correo ya está registrado' });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const { rows } = await pool.query(
        `INSERT INTO usuarios (nombre, correo, password_hash, rol)
         VALUES ($1, $2, $3, $4)
         RETURNING id, nombre, correo, rol`,
        [nombre, correo, passwordHash, rol]
      );
      const usuario = rows[0];
      res.status(201).json({ token: firmar(usuario), usuario: usuarioPublico(usuario) });
    } catch (err) {
      if (err && err.code === '23505') {
        return res.status(409).json({ error: 'Ese correo ya está registrado' });
      }
      console.error(err);
      res.status(500).json({ error: 'No se pudo crear la cuenta' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    const correo = normalizarCorreo(req.body?.correo);
    const password = String(req.body?.password || '');

    if (!correo || !password) {
      return res.status(400).json({ error: 'Correo y contraseña son obligatorios' });
    }

    try {
      const usuario = await buscarUsuarioPorCorreo(pool, correo);
      const coincide = usuario ? await bcrypt.compare(password, usuario.password_hash) : false;
      if (!usuario || !coincide) {
        return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
      }

      res.json({ token: firmar(usuario), usuario: usuarioPublico(usuario) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo iniciar sesión' });
    }
  });

  app.post('/api/auth/recuperar', async (req, res) => {
    const correo = normalizarCorreo(req.body?.correo);
    if (!correoValido(correo)) {
      return res.status(400).json({ error: 'Ingresa un correo válido' });
    }
    if (limitado(correo)) {
      return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' });
    }
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      return res.status(500).json({ error: 'El envío de correo no está configurado' });
    }

    try {
      const usuario = await buscarUsuarioPorCorreo(pool, correo);
      if (!usuario) {
        return res.status(404).json({ error: 'El correo no corresponde a un usuario registrado' });
      }

      const token = crypto.randomBytes(32).toString('hex');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE tokens_recuperacion
           SET usado = true
           WHERE usuario_id = $1 AND usado = false`,
          [usuario.id]
        );
        await client.query(
          `INSERT INTO tokens_recuperacion (usuario_id, token, fecha_expiracion, usado)
           VALUES ($1, $2, current_timestamp() + INTERVAL '30 minutes', false)`,
          [usuario.id, hashToken(token)]
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      const enlace = `${urlBase(req)}/restablecer.html?token=${encodeURIComponent(token)}`;
      try {
        await transporter().sendMail({
          from: `"AquaManager" <${process.env.EMAIL_USER}>`,
          to: usuario.correo,
          subject: 'Restablece tu contraseña de AquaManager',
          text: [
            `Hola ${usuario.nombre},`,
            '',
            'Recibimos una solicitud para restablecer tu contraseña.',
            `El enlace es válido por ${TOKEN_MINUTOS} minutos y solo puede usarse una vez:`,
            enlace,
            '',
            'Si no solicitaste este cambio, ignora este correo.',
          ].join('\n'),
          html: `
            <p>Hola ${escaparHtml(usuario.nombre)},</p>
            <p>Recibimos una solicitud para restablecer tu contraseña en AquaManager.</p>
            <p>Este enlace es válido por ${TOKEN_MINUTOS} minutos y solo puede usarse una vez:</p>
            <p><a href="${escaparHtml(enlace)}">Restablecer contraseña</a></p>
            <p>Si no solicitaste este cambio, ignora este correo.</p>
          `,
        });
      } catch (err) {
        await pool.query('UPDATE tokens_recuperacion SET usado = true WHERE token = $1', [hashToken(token)]);
        console.error('No se pudo enviar el correo de recuperación:', err.message);
        return res.status(500).json({ error: 'No se pudo enviar el correo de recuperación' });
      }

      res.json({
        ok: true,
        correo: usuario.correo,
        expiraEnMinutos: TOKEN_MINUTOS,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo iniciar la recuperación' });
    }
  });

  app.get('/api/auth/recuperar/validar', async (req, res) => {
    const token = String(req.query.token || '');
    if (!token) {
      return res.status(400).json({ error: 'El enlace de recuperación no es válido' });
    }

    try {
      const registro = await buscarToken(pool, token);
      if (!registro) {
        return res.status(400).json({ error: 'El enlace de recuperación no es válido' });
      }
      if (registro.usado) {
        return res.status(400).json({ error: 'Este enlace ya fue utilizado' });
      }
      if (!registro.vigente) {
        return res.status(400).json({ error: 'El enlace expiró. Solicita uno nuevo.' });
      }

      res.json({ ok: true, nombre: registro.nombre });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo validar el enlace' });
    }
  });

  app.post('/api/auth/restablecer', async (req, res) => {
    const token = String(req.body?.token || '');
    const errorClave = validarPassword(req.body?.password, req.body?.confirmacion);
    if (!token) {
      return res.status(400).json({ error: 'El enlace de recuperación no es válido' });
    }
    if (errorClave) {
      return res.status(400).json({ error: errorClave });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT t.id, t.usuario_id, t.usado, t.fecha_expiracion > current_timestamp() AS vigente
         FROM tokens_recuperacion t
         WHERE t.token = $1
         FOR UPDATE`,
        [hashToken(token)]
      );
      const registro = rows[0];
      if (!registro) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'El enlace de recuperación no es válido' });
      }
      if (registro.usado) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Este enlace ya fue utilizado' });
      }
      if (!registro.vigente) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'El enlace expiró. Solicita uno nuevo.' });
      }

      const passwordHash = await bcrypt.hash(String(req.body.password), 10);
      await client.query('UPDATE usuarios SET password_hash = $1 WHERE id = $2', [passwordHash, registro.usuario_id]);
      await client.query('UPDATE tokens_recuperacion SET usado = true WHERE usuario_id = $1', [registro.usuario_id]);
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(err);
      res.status(500).json({ error: 'No se pudo actualizar la contraseña' });
    } finally {
      client.release();
    }
  });
}

function urlBase(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

async function verificarCorreo() {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.error('EMAIL_USER o EMAIL_PASS no están definidos. La recuperación de contraseña no podrá enviar correos.');
    return;
  }
  try {
    await transporter().verify();
    console.log('Correo de recuperación listo');
  } catch (err) {
    console.error('No se pudo verificar el correo de recuperación:', err.message);
  }
}

module.exports = {
  initAuth,
  registrarAuth,
  requireAuth,
  verificarCorreo,
};
