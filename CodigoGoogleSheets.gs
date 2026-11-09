// ====================================================================
// SCRIPT DE GOOGLE APPS SCRIPT PARA GOOGLE SHEETS
// ====================================================================
// - Verificación de contraseña en la hoja PASSWORD (celda A1)
// - Registro de lecturas QR con FECHA, HORA y DATO en la hoja Registros_QR
// ====================================================================

/**
 * Obtiene o crea la hoja PASSWORD y retorna la contraseña almacenada en A1.
 * Si la hoja no existe, la crea con una contraseña por defecto ("1234").
 */
function obtenerPasswordConfigurada() {
  const libro = SpreadsheetApp.getActiveSpreadsheet();
  let hojaPass = libro.getSheetByName("PASSWORD");

  if (!hojaPass) {
    hojaPass = libro.insertSheet("PASSWORD");
    hojaPass.getRange("A1").setValue("1234");
    hojaPass.getRange("B1").setValue("<- CONTRASEÑA DE ACCESO (Puedes cambiarla aquí)");
    
    // Formato visual amigable
    hojaPass.getRange("A1").setBackground("#fef3c7").setFontWeight("bold").setFontSize(12);
    hojaPass.getRange("B1").setFontColor("#64748b").setFontStyle("italic");
    hojaPass.autoResizeColumns(1, 2);
  }

  const valor = hojaPass.getRange("A1").getValue();
  return valor ? valor.toString().trim() : "";
}

/**
 * Valida si la contraseña proporcionada coincide con la celda A1 de la hoja PASSWORD
 */
function validarPassword(passIngresada) {
  const passReal = obtenerPasswordConfigurada();
  if (!passIngresada) return false;
  return passIngresada.toString().trim() === passReal;
}

/**
 * Asegura los encabezados en la hoja de registros
 */
function asegurarEncabezados(hoja) {
  if (hoja.getLastRow() === 0) {
    const encabezados = ["FECHA", "HORA", "DATO QR", "FECHA REGISTRO COMPLETA"];
    hoja.appendRow(encabezados);
    
    const rangoEncabezado = hoja.getRange(1, 1, 1, encabezados.length);
    rangoEncabezado.setBackground("#1a73e8");
    rangoEncabezado.setFontColor("#ffffff");
    rangoEncabezado.setFontWeight("bold");
    rangoEncabezado.setHorizontalAlignment("center");
    hoja.setFrozenRows(1);
    hoja.autoResizeColumns(1, encabezados.length);
  }
}

/**
 * Inserta un registro en la hoja Registros_QR
 */
function insertarRegistro(fecha, hora, datoQr) {
  const libro = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = libro.getSheetByName("Registros_QR");

  if (!hoja) {
    hoja = libro.insertSheet("Registros_QR");
  }

  asegurarEncabezados(hoja);

  const ahora = new Date();
  const zonaHoraria = libro.getSpreadsheetTimeZone() || Session.getScriptTimeZone();

  const fechaFinal = fecha || Utilities.formatDate(ahora, zonaHoraria, "dd/MM/yyyy");
  const horaFinal = hora || Utilities.formatDate(ahora, zonaHoraria, "HH:mm:ss");
  const datoFinal = datoQr || "SIN_DATOS";
  const registroIso = ahora.toISOString();

  hoja.appendRow([fechaFinal, horaFinal, datoFinal, registroIso]);
  hoja.autoResizeColumns(1, 4);

  return { status: "success", fila: hoja.getLastRow() };
}

/**
 * Manejador de solicitudes GET:
 * Permite verificar contraseña de forma rápida con CORS desde el navegador web.
 */
function doGet(e) {
  const parametros = e.parameter || {};
  const accion = parametros.accion;

  // Acción: Verificar contraseña
  if (accion === "verificar" || accion === "login") {
    const pass = parametros.pass || "";
    const esValido = validarPassword(pass);

    const respuesta = {
      status: esValido ? "success" : "error",
      authorized: esValido,
      message: esValido 
        ? "Contraseña verificada correctamente con Google Sheets." 
        : "Contraseña incorrecta. Revisa la celda A1 de la hoja 'PASSWORD'."
    };

    return ContentService
      .createTextOutput(JSON.stringify(respuesta))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Si no se pasa acción, responde confirmando servicio activo
  return ContentService
    .createTextOutput(JSON.stringify({
      status: "online",
      message: "Servicio Google Apps Script activo. Conexión establecida."
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Manejador de solicitudes POST:
 * Recibe y procesa tanto la verificación de contraseña como el guardado de QR.
 */
function doPost(e) {
  const bloqueo = LockService.getScriptLock();
  
  try {
    bloqueo.waitLock(10000);
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: "error", message: "Servidor ocupado. Intenta de nuevo." }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  try {
    let datos = {};
    if (e.postData && e.postData.contents) {
      try {
        datos = JSON.parse(e.postData.contents);
      } catch (err) {
        datos = e.parameter || {};
      }
    } else {
      datos = e.parameter || {};
    }

    const accion = datos.accion;

    // 1. Verificación de contraseña vía POST
    if (accion === "verificar" || accion === "login") {
      const pass = datos.pass || datos.password || "";
      const esValido = validarPassword(pass);

      return ContentService
        .createTextOutput(JSON.stringify({
          status: esValido ? "success" : "error",
          authorized: esValido,
          message: esValido 
            ? "Acceso concedido." 
            : "Contraseña incorrecta. Verifica la celda A1 de la hoja 'PASSWORD'."
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 2. Registro de código QR
    // Si viene con contraseña, verificarla opcionalmente para proteger escrituras públicas
    if (datos.pass && !validarPassword(datos.pass)) {
      return ContentService
        .createTextOutput(JSON.stringify({
          status: "error",
          authorized: false,
          message: "No autorizado. Contraseña no coincide con celda A1 de la hoja PASSWORD."
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const fecha = datos.fecha;
    const hora = datos.hora;
    const datoQr = datos.datoQr || datos.qr || datos.dato;

    const res = insertarRegistro(fecha, hora, datoQr);

    return ContentService
      .createTextOutput(JSON.stringify({
        status: "success",
        message: "QR registrado correctamente en Google Sheets",
        fila: res.fila,
        datos: { fecha: fecha, hora: hora, datoQr: datoQr }
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);

  } finally {
    bloqueo.releaseLock();
  }
}
