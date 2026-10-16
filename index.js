require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { initAuth, registrarAuth, requireAuth, verificarCorreo } = require('./auth');
const { registrarReportes } = require('./reportes');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL no está definida. Revisa el archivo .env');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS clientes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre VARCHAR(150) NOT NULL,
    alias VARCHAR(100),
    direccion VARCHAR(255) NOT NULL,
    tipo_envase VARCHAR(80) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

let timeColumn = 'created_at';

async function columnasClientes() {
  const { rows } = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'clientes'
  `);
  return new Set(rows.map((row) => row.column_name));
}

async function initDb() {
  await initAuth(pool);
  let columnas = await columnasClientes();

  if (columnas.size === 0) {
    await pool.query(CREATE_TABLE_SQL);
    timeColumn = 'created_at';
    return;
  }

  if (columnas.has('alias_contacto') && !columnas.has('alias')) {
    await pool.query('ALTER TABLE clientes RENAME COLUMN alias_contacto TO alias');
  }
  if (columnas.has('envase_predeterminado') && !columnas.has('tipo_envase')) {
    await pool.query('ALTER TABLE clientes RENAME COLUMN envase_predeterminado TO tipo_envase');
  }

  columnas = await columnasClientes();

  if (!columnas.has('alias')) {
    await pool.query('ALTER TABLE clientes ADD COLUMN alias VARCHAR(100)');
  }
  if (!columnas.has('tipo_envase')) {
    await pool.query(`ALTER TABLE clientes ADD COLUMN tipo_envase VARCHAR(80) NOT NULL DEFAULT 'Garrafón 20L'`);
  }
  if (!columnas.has('created_at') && !columnas.has('fecha_registro')) {
    await pool.query('ALTER TABLE clientes ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now()');
    timeColumn = 'created_at';
    return;
  }

  timeColumn = columnas.has('fecha_registro') ? 'fecha_registro' : 'created_at';
}

function columnasSelect() {
  return `id, nombre, alias, direccion, tipo_envase, ${timeColumn} AS created_at`;
}

function validarCliente(body) {
  const nombre = String(body.nombre || '').trim();
  const alias = String(body.alias || '').trim();
  const direccion = String(body.direccion || '').trim();
  const tipoEnvase = String(body.tipo_envase || '').trim();

  if (!nombre || !direccion || !tipoEnvase) {
    return { error: 'nombre, direccion y tipo_envase son obligatorios' };
  }

  if (nombre.length > 150 || alias.length > 100 || direccion.length > 255 || tipoEnvase.length > 80) {
    return { error: 'Uno o más campos superan la longitud permitida' };
  }

  return {
    nombre,
    alias: alias || null,
    direccion,
    tipo_envase: tipoEnvase,
  };
}

function esErrorDeUuid(err) {
  return err && err.code === '22P02';
}

function esCheckEnvase(err) {
  return err && err.code === '23514';
}

const MENSAJE_ENVASE = 'tipo_envase debe ser cristal, brisa, redondo, generico o pet';

async function listarClientesReporte() {
  const { rows } = await pool.query(
    `SELECT nombre, alias, direccion, tipo_envase
     FROM clientes
     ORDER BY nombre ASC`
  );
  return rows;
}

async function listarVentasReporte() {
  const { rows } = await pool.query(
    `SELECT c.nombre AS cliente,
            u.nombre AS repartidor,
            v.monto,
            v.metodo_pago,
            v.estado_deuda,
            v.fecha_venta
     FROM ventas v
     JOIN clientes c ON c.id = v.cliente_id
     JOIN usuarios u ON u.id = v.repartidor_id
     ORDER BY v.fecha_venta DESC`
  );

  return rows.map((fila) => ({
    cliente: fila.cliente,
    repartidor: fila.repartidor,
    monto: Number(fila.monto).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }),
    metodo_pago: fila.metodo_pago,
    estado_deuda: fila.estado_deuda,
    fecha_venta: new Date(fila.fecha_venta).toLocaleString('es-CO', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'America/Bogota',
    }),
  }));
}

app.use(cors());
app.use(express.json());
registrarAuth(app, pool);
app.use('/api/clientes', requireAuth);
app.use('/api/reportes', requireAuth);
registrarReportes(app, {
  clientes: listarClientesReporte,
  ventas: listarVentasReporte,
});
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/clientes', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${columnasSelect()}
       FROM clientes
       ORDER BY ${timeColumn} DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron obtener los clientes' });
  }
});

app.post('/api/clientes', async (req, res) => {
  const data = validarCliente(req.body || {});
  if (data.error) {
    return res.status(400).json({ error: data.error });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO clientes (nombre, alias, direccion, tipo_envase)
       VALUES ($1, $2, $3, $4)
       RETURNING ${columnasSelect()}`,
      [data.nombre, data.alias, data.direccion, data.tipo_envase]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (esCheckEnvase(err)) {
      return res.status(400).json({ error: MENSAJE_ENVASE });
    }
    console.error(err);
    res.status(500).json({ error: 'No se pudo crear el cliente' });
  }
});

app.put('/api/clientes/:id', async (req, res) => {
  const data = validarCliente(req.body || {});
  if (data.error) {
    return res.status(400).json({ error: data.error });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE clientes
       SET nombre = $1, alias = $2, direccion = $3, tipo_envase = $4
       WHERE id = $5
       RETURNING ${columnasSelect()}`,
      [data.nombre, data.alias, data.direccion, data.tipo_envase, req.params.id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    res.json(rows[0]);
  } catch (err) {
    if (esErrorDeUuid(err)) {
      return res.status(400).json({ error: 'Identificador de cliente inválido' });
    }
    if (esCheckEnvase(err)) {
      return res.status(400).json({ error: MENSAJE_ENVASE });
    }
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar el cliente' });
  }
});

app.delete('/api/clientes/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM clientes WHERE id = $1', [req.params.id]);
    if (!result.rowCount) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    res.json({ ok: true });
  } catch (err) {
    if (esErrorDeUuid(err)) {
      return res.status(400).json({ error: 'Identificador de cliente inválido' });
    }
    console.error(err);
    res.status(500).json({ error: 'No se pudo eliminar el cliente' });
  }
});

initDb()
  .then(async () => {
    await verificarCorreo();
    app.listen(PORT, () => {
      console.log(`AquaManager escuchando en http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('No se pudo inicializar la base de datos:', err.message);
    process.exit(1);
  });
