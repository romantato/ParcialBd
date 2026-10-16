const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

const COLUMNAS = [
  { titulo: 'Nombre', campo: 'nombre', anchoPdf: 130, anchoExcel: 28 },
  { titulo: 'Alias', campo: 'alias', anchoPdf: 110, anchoExcel: 24 },
  { titulo: 'Dirección', campo: 'direccion', anchoPdf: 190, anchoExcel: 42 },
  { titulo: 'Envase', campo: 'tipo_envase', anchoPdf: 80, anchoExcel: 16 },
];

function fechaLegible() {
  return new Date().toLocaleString('es-CO', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'America/Bogota',
  });
}

function nuevoReporteId() {
  const ahora = new Date();
  const parte = (valor) => String(valor).padStart(2, '0');
  const fecha = `${ahora.getFullYear()}${parte(ahora.getMonth() + 1)}${parte(ahora.getDate())}`;
  const hora = `${parte(ahora.getHours())}${parte(ahora.getMinutes())}${parte(ahora.getSeconds())}`;
  return `AM-${fecha}-${hora}`;
}

function valor(cliente, campo) {
  const texto = String(cliente[campo] || '').trim();
  return texto || '—';
}

function dibujarEncabezado(doc, y) {
  let x = doc.page.margins.left;
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a');
  COLUMNAS.forEach((columna) => {
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

function escribirPdf(doc, clientes, meta) {
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#0f172a').text('Reporte de Clientes AquaManager');
  doc.moveDown(0.4);
  doc.font('Helvetica').fontSize(10).fillColor('#334155');
  doc.text(`Fecha de generación: ${meta.fecha}`);
  doc.text(`ID del reporte: ${meta.id}`);
  doc.text(`Total de clientes: ${clientes.length}`);
  doc.moveDown(0.8);

  let y = dibujarEncabezado(doc, doc.y);
  doc.font('Helvetica').fontSize(9).fillColor('#1e293b');

  if (!clientes.length) {
    doc.text('No hay clientes registrados.', doc.page.margins.left, y);
    return;
  }

  clientes.forEach((cliente) => {
    const textos = COLUMNAS.map((columna) => valor(cliente, columna.campo));
    const alto = Math.max(
      ...textos.map((texto, indice) => doc.heightOfString(texto, { width: COLUMNAS[indice].anchoPdf }))
    );

    if (y + alto > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = dibujarEncabezado(doc, doc.page.margins.top);
      doc.font('Helvetica').fontSize(9).fillColor('#1e293b');
    }

    let x = doc.page.margins.left;
    textos.forEach((texto, indice) => {
      doc.text(texto, x, y, { width: COLUMNAS[indice].anchoPdf });
      x += COLUMNAS[indice].anchoPdf;
    });
    y += alto + 8;
  });
}

async function escribirExcel(clientes, meta) {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'AquaManager';
  const hoja = libro.addWorksheet('Clientes');

  hoja.mergeCells('A1:D1');
  hoja.getCell('A1').value = 'Reporte de Clientes AquaManager';
  hoja.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF0F172A' } };
  hoja.getCell('A2').value = 'ID del reporte';
  hoja.getCell('B2').value = meta.id;
  hoja.getCell('A3').value = 'Fecha de generación';
  hoja.getCell('B3').value = meta.fecha;
  hoja.getCell('A4').value = 'Total de clientes';
  hoja.getCell('B4').value = clientes.length;

  const encabezado = hoja.addRow(COLUMNAS.map((columna) => columna.titulo));
  encabezado.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  encabezado.eachCell((celda) => {
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0369A1' } };
  });

  clientes.forEach((cliente) => {
    hoja.addRow(COLUMNAS.map((columna) => valor(cliente, columna.campo)));
  });

  COLUMNAS.forEach((columna, indice) => {
    hoja.getColumn(indice + 1).width = columna.anchoExcel;
  });
  hoja.getRow(5).eachCell((celda) => {
    celda.alignment = { vertical: 'middle' };
  });
  hoja.views = [{ state: 'frozen', ySplit: 5 }];
  return libro;
}

function registrarReportes(app, listarClientes) {
  app.get('/api/reportes/clientes/pdf', async (_req, res) => {
    try {
      const clientes = await listarClientes();
      const meta = { id: nuevoReporteId(), fecha: fechaLegible() };
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="reporte-clientes-${meta.id}.pdf"`);
      doc.pipe(res);
      escribirPdf(doc, clientes, meta);
      doc.end();
    } catch (err) {
      console.error(err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'No se pudo generar el reporte PDF' });
      }
    }
  });

  app.get('/api/reportes/clientes/excel', async (_req, res) => {
    try {
      const clientes = await listarClientes();
      const meta = { id: nuevoReporteId(), fecha: fechaLegible() };
      const libro = await escribirExcel(clientes, meta);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="reporte-clientes-${meta.id}.xlsx"`);
      await libro.xlsx.write(res);
      res.end();
    } catch (err) {
      console.error(err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'No se pudo generar el reporte Excel' });
      }
    }
  });
}

module.exports = { registrarReportes };
