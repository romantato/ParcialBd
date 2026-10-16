const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

function fechaLegible() {
  return new Date().toLocaleString('es-CO', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'America/Bogota',
  });
}

function nuevoReporteId(prefijo) {
  const ahora = new Date();
  const parte = (valor) => String(valor).padStart(2, '0');
  const fecha = `${ahora.getFullYear()}${parte(ahora.getMonth() + 1)}${parte(ahora.getDate())}`;
  const hora = `${parte(ahora.getHours())}${parte(ahora.getMinutes())}${parte(ahora.getSeconds())}`;
  const sufijo = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${prefijo}-${fecha}-${hora}-${sufijo}`;
}

function valor(fila, campo) {
  const texto = String(fila[campo] ?? '').trim();
  return texto || '—';
}

function dibujarEncabezado(doc, columnas, y) {
  let x = doc.page.margins.left;
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f172a');
  columnas.forEach((columna) => {
    doc.text(columna.titulo, x, y, { width: columna.anchoPdf });
    x += columna.anchoPdf;
  });
  const linea = y + 14;
  doc
    .moveTo(doc.page.margins.left, linea)
    .lineTo(doc.page.width - doc.page.margins.right, linea)
    .strokeColor('#cbd5e1')
    .stroke();
  return linea + 8;
}

function escribirPdf(doc, filas, columnas, meta) {
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#0f172a').text(meta.titulo);
  doc.moveDown(0.4);
  doc.font('Helvetica').fontSize(10).fillColor('#334155');
  doc.text(`Fecha de generación: ${meta.fecha}`);
  doc.text(`ID del reporte: ${meta.id}`);
  doc.text(`Registros: ${filas.length}`);
  doc.moveDown(0.8);

  let y = dibujarEncabezado(doc, columnas, doc.y);
  doc.font('Helvetica').fontSize(8).fillColor('#1e293b');

  if (!filas.length) {
    doc.text(meta.vacio, doc.page.margins.left, y);
    return;
  }

  filas.forEach((fila) => {
    const textos = columnas.map((columna) => valor(fila, columna.campo));
    const alto = Math.max(
      ...textos.map((texto, indice) => doc.heightOfString(texto, { width: columnas[indice].anchoPdf }))
    );

    if (y + alto > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = dibujarEncabezado(doc, columnas, doc.page.margins.top);
      doc.font('Helvetica').fontSize(8).fillColor('#1e293b');
    }

    let x = doc.page.margins.left;
    textos.forEach((texto, indice) => {
      doc.text(texto, x, y, { width: columnas[indice].anchoPdf });
      x += columnas[indice].anchoPdf;
    });
    y += alto + 8;
  });
}

async function escribirExcel(filas, columnas, meta) {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'AquaManager';
  const hoja = libro.addWorksheet(meta.hoja);
  const ultima = String.fromCharCode(64 + columnas.length);

  hoja.mergeCells(`A1:${ultima}1`);
  hoja.getCell('A1').value = meta.titulo;
  hoja.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF0F172A' } };
  hoja.getCell('A2').value = 'ID del reporte';
  hoja.getCell('B2').value = meta.id;
  hoja.getCell('A3').value = 'Fecha de generación';
  hoja.getCell('B3').value = meta.fecha;
  hoja.getCell('A4').value = 'Registros';
  hoja.getCell('B4').value = filas.length;

  const encabezado = hoja.addRow(columnas.map((columna) => columna.titulo));
  encabezado.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  encabezado.eachCell((celda) => {
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0369A1' } };
  });

  filas.forEach((fila) => {
    hoja.addRow(columnas.map((columna) => valor(fila, columna.campo)));
  });

  columnas.forEach((columna, indice) => {
    hoja.getColumn(indice + 1).width = columna.anchoExcel;
  });
  hoja.views = [{ state: 'frozen', ySplit: 5 }];
  return libro;
}

function enviarPdf(res, filas, definicion, meta) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${definicion.archivo}-${meta.id}.pdf"`);
  doc.pipe(res);
  escribirPdf(doc, filas, definicion.columnas, meta);
  doc.end();
}

async function enviarExcel(res, filas, definicion, meta) {
  const libro = await escribirExcel(filas, definicion.columnas, meta);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${definicion.archivo}-${meta.id}.xlsx"`);
  await libro.xlsx.write(res);
  res.end();
}

const REPORTES = {
  clientes: {
    titulo: 'Reporte de Clientes AquaManager',
    hoja: 'Clientes',
    archivo: 'reporte-clientes',
    prefijo: 'CLI',
    vacio: 'No hay clientes registrados.',
    columnas: [
      { titulo: 'Nombre', campo: 'nombre', anchoPdf: 130, anchoExcel: 28 },
      { titulo: 'Alias', campo: 'alias', anchoPdf: 110, anchoExcel: 24 },
      { titulo: 'Dirección', campo: 'direccion', anchoPdf: 190, anchoExcel: 42 },
      { titulo: 'Envase', campo: 'tipo_envase', anchoPdf: 80, anchoExcel: 16 },
    ],
  },
  ventas: {
    titulo: 'Reporte de Ventas AquaManager',
    hoja: 'Ventas',
    archivo: 'reporte-ventas',
    prefijo: 'VTA',
    vacio: 'No hay ventas registradas.',
    columnas: [
      { titulo: 'Cliente', campo: 'cliente', anchoPdf: 100, anchoExcel: 24 },
      { titulo: 'Repartidor', campo: 'repartidor', anchoPdf: 100, anchoExcel: 22 },
      { titulo: 'Monto', campo: 'monto', anchoPdf: 70, anchoExcel: 14 },
      { titulo: 'Pago', campo: 'metodo_pago', anchoPdf: 70, anchoExcel: 14 },
      { titulo: 'Estado', campo: 'estado_deuda', anchoPdf: 70, anchoExcel: 14 },
      { titulo: 'Fecha', campo: 'fecha_venta', anchoPdf: 100, anchoExcel: 20 },
    ],
  },
};

function registrarReportes(app, consultas) {
  Object.entries(REPORTES).forEach(([clave, definicion]) => {
    app.get(`/api/reportes/${clave}/pdf`, async (_req, res) => {
      try {
        const filas = await consultas[clave]();
        const meta = {
          id: nuevoReporteId(definicion.prefijo),
          fecha: fechaLegible(),
          titulo: definicion.titulo,
          hoja: definicion.hoja,
          vacio: definicion.vacio,
        };
        enviarPdf(res, filas, definicion, meta);
      } catch (err) {
        console.error(err);
        if (!res.headersSent) res.status(500).json({ error: 'No se pudo generar el reporte PDF' });
      }
    });

    app.get(`/api/reportes/${clave}/excel`, async (_req, res) => {
      try {
        const filas = await consultas[clave]();
        const meta = {
          id: nuevoReporteId(definicion.prefijo),
          fecha: fechaLegible(),
          titulo: definicion.titulo,
          hoja: definicion.hoja,
          vacio: definicion.vacio,
        };
        await enviarExcel(res, filas, definicion, meta);
      } catch (err) {
        console.error(err);
        if (!res.headersSent) res.status(500).json({ error: 'No se pudo generar el reporte Excel' });
      }
    });
  });
}

module.exports = { registrarReportes };
