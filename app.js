/**
 * ====================================================================
 * APLICACIÓN LECTOR QR CON ALMACENAMIENTO EN GOOGLE SHEETS
 * ====================================================================
 * Desarrollado en HTML5, JavaScript y CSS.
 * Integra autenticación con contraseña almacenada en PASSWORD!A1
 * y registro automático de lecturas QR con FECHA, HORA y DATO.
 * ====================================================================
 */

// Estado global de la aplicación
const AppState = {
  html5QrCode: null,
  isScanning: false,
  selectedCameraId: null,
  googleSheetUrl: localStorage.getItem('qr_sheets_url') || '',
  password: localStorage.getItem('qr_sheets_password') || '',
  isAuthenticated: localStorage.getItem('qr_auth_verified') === 'true',
  audioEnabled: localStorage.getItem('qr_audio_enabled') !== 'false',
  cooldownSeconds: parseInt(localStorage.getItem('qr_cooldown') || '3', 10),
  lastScannedText: '',
  lastScannedTime: 0,
  history: JSON.parse(localStorage.getItem('qr_history') || '[]'),
  nativeDetectorActive: false,
  nativeVideoTrack: null
};

// ====================================================================
// ELEMENTOS DEL DOM
// ====================================================================
const elements = {
  // Pantalla de autenticación inicial
  authScreen: document.getElementById('auth-screen'),
  authForm: document.getElementById('auth-form'),
  authUrl: document.getElementById('auth-url'),
  authPassword: document.getElementById('auth-password'),
  btnTogglePassword: document.getElementById('btn-toggle-password'),
  authErrorMsg: document.getElementById('auth-error-msg'),
  btnSubmitAuth: document.getElementById('btn-submit-auth'),
  authBtnSpinner: document.getElementById('auth-btn-spinner'),
  authBtnText: document.getElementById('auth-btn-text'),

  // Interfaz de la aplicación principal
  appContainer: document.getElementById('app-container'),
  btnLogout: document.getElementById('btn-logout'),
  cameraSelect: document.getElementById('camera-select'),
  btnStart: document.getElementById('btn-start-scan'),
  btnStop: document.getElementById('btn-stop-scan'),
  scannerOverlay: document.getElementById('scanner-overlay'),
  cameraPlaceholder: document.getElementById('camera-placeholder'),
  readerContainer: document.getElementById('reader'),
  statusBadge: document.getElementById('connection-status-badge'),
  statusText: document.getElementById('connection-status-text'),
  lastScanCard: document.getElementById('last-scan-card'),
  lastScanData: document.getElementById('last-scan-data'),
  lastScanTime: document.getElementById('last-scan-time'),
  recordsTableBody: document.getElementById('records-table-body'),
  emptyState: document.getElementById('empty-state'),
  totalScansSpan: document.getElementById('total-scans'),
  pendingScansSpan: document.getElementById('pending-scans'),
  btnExportCsv: document.getElementById('btn-export-csv'),
  btnClearHistory: document.getElementById('btn-clear-history'),
  btnRetryPending: document.getElementById('btn-retry-pending'),
  btnManualInput: document.getElementById('btn-manual-input'),
  toastContainer: document.getElementById('toast-container'),
  toggleAudio: document.getElementById('toggle-audio'),
  cooldownSelect: document.getElementById('cooldown-select'),
  manualModal: document.getElementById('manual-modal'),
  btnCloseManual: document.getElementById('btn-close-manual'),
  formManual: document.getElementById('form-manual'),
  inputManualCode: document.getElementById('input-manual-code')
};

// ====================================================================
// SONIDOS Y AUDIO CON WEB AUDIO API
// ====================================================================
let audioCtx = null;

function reproducirSonidoExito() {
  if (!AppState.audioEnabled) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1320, audioCtx.currentTime + 0.1);

    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);

    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.15);
  } catch (e) {
    console.warn('Audio no disponible:', e);
  }
}

function reproducirSonidoError() {
  if (!AppState.audioEnabled) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.25);

    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.25);
  } catch (e) {
    console.warn('Audio no disponible:', e);
  }
}

// ====================================================================
// NOTIFICACIONES FLOTANTES (TOAST)
// ====================================================================
function mostrarNotificacion(mensaje, tipo = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${tipo}`;
  toast.innerHTML = `<span>${mensaje}</span>`;
  elements.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ====================================================================
// INICIALIZACIÓN DE LA APLICACIÓN
// ====================================================================
document.addEventListener('DOMContentLoaded', () => {
  // Escuchadores de eventos
  asignarEventos();

  // Verificar si ya cuenta con sesión autenticada
  if (AppState.isAuthenticated && AppState.googleSheetUrl && AppState.password) {
    activarInterfazPrincipal();
  } else {
    activarPantallaLogin();
  }
});

function activarPantallaLogin() {
  elements.appContainer.style.display = 'none';
  elements.authScreen.style.display = 'flex';
  
  if (AppState.googleSheetUrl) {
    elements.authUrl.value = AppState.googleSheetUrl;
  }
  elements.authPassword.value = '';
  elements.authErrorMsg.style.display = 'none';
}

function activarInterfazPrincipal() {
  elements.authScreen.style.display = 'none';
  elements.appContainer.style.display = 'flex';

  elements.toggleAudio.checked = AppState.audioEnabled;
  elements.cooldownSelect.value = AppState.cooldownSeconds.toString();

  // Renderizar historial previo
  renderizarHistorial();

  // Inicializar cámaras
  inicializarCamaras();
}

// ====================================================================
// AUTENTICACIÓN Y VALIDACIÓN CON GOOGLE SHEETS
// ====================================================================
async function procesarLogin(e) {
  e.preventDefault();

  const urlIngresada = elements.authUrl.value.trim();
  const passIngresada = elements.authPassword.value.trim();

  // 1. Validaciones locales de formato
  if (!urlIngresada.startsWith('https://script.google.com/macros/s/')) {
    mostrarErrorAuth('La URL debe comenzar con: https://script.google.com/macros/s/...');
    return;
  }

  if (!urlIngresada.includes('/exec')) {
    mostrarErrorAuth('La URL debe terminar en /exec (URL de la aplicación web implementada).');
    return;
  }

  if (!passIngresada) {
    mostrarErrorAuth('Por favor ingresa la contraseña configurada en la celda A1 de la hoja PASSWORD.');
    return;
  }

  // Activar estado de carga
  setAuthLoading(true);
  ocultarErrorAuth();

  try {
    // 2. Probar conexión y validar contraseña con Google Sheets
    // Se utiliza el endpoint GET con la acción de verificación
    const endpointPrueba = `${urlIngresada}?accion=verificar&pass=${encodeURIComponent(passIngresada)}&_t=${Date.now()}`;
    
    const respuesta = await fetch(endpointPrueba, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    if (!respuesta.ok) {
      throw new Error(`El servidor respondió con código ${respuesta.status}`);
    }

    const resultado = await respuesta.json();

    if (resultado.authorized === true || resultado.status === 'success') {
      // ✅ Contraseña correcta y hoja vinculada
      AppState.googleSheetUrl = urlIngresada;
      AppState.password = passIngresada;
      AppState.isAuthenticated = true;

      localStorage.setItem('qr_sheets_url', urlIngresada);
      localStorage.setItem('qr_sheets_password', passIngresada);
      localStorage.setItem('qr_auth_verified', 'true');

      reproducirSonidoExito();
      mostrarNotificacion('✅ Vinculado con éxito a Google Sheets', 'success');
      activarInterfazPrincipal();
    } else {
      // ❌ Contraseña incorrecta
      reproducirSonidoError();
      mostrarErrorAuth(resultado.message || 'Contraseña incorrecta. Revisa la celda A1 de la pestaña "PASSWORD".');
    }

  } catch (err) {
    console.error('Error de autenticación:', err);
    reproducirSonidoError();
    mostrarErrorAuth(
      'No se pudo conectar con Google Apps Script. Verifica que hayas implementado la aplicación web con acceso a "Cualquiera" (Anyone) y que la URL termine en /exec.'
    );
  } finally {
    setAuthLoading(false);
  }
}

function setAuthLoading(cargando) {
  if (cargando) {
    elements.btnSubmitAuth.disabled = true;
    elements.authBtnSpinner.style.display = 'inline-block';
    elements.authBtnText.textContent = ' Verificando credenciales...';
  } else {
    elements.btnSubmitAuth.disabled = false;
    elements.authBtnSpinner.style.display = 'none';
    elements.authBtnText.textContent = '🔐 Conectar y Desbloquear';
  }
}

function mostrarErrorAuth(mensaje) {
  elements.authErrorMsg.className = 'auth-alert error';
  elements.authErrorMsg.innerHTML = `⚠️ <strong>Error:</strong> ${escapeHtml(mensaje)}`;
  elements.authErrorMsg.style.display = 'block';
}

function ocultarErrorAuth() {
  elements.authErrorMsg.style.display = 'none';
}

function cerrarSesion() {
  if (confirm('¿Deseas desvincular esta hoja de cálculo y cerrar sesión?')) {
    detenerEscaneo();
    AppState.isAuthenticated = false;
    AppState.password = '';
    localStorage.removeItem('qr_auth_verified');
    localStorage.removeItem('qr_sheets_password');
    activarPantallaLogin();
    mostrarNotificacion('Sesión cerrada. Debes ingresar tus credenciales para volver a entrar.', 'info');
  }
}

// ====================================================================
// CONTROL DE CÁMARAS Y ESCÁNER QR
// ====================================================================
async function inicializarCamaras() {
  try {
    if (typeof Html5Qrcode !== 'undefined') {
      const devices = await Html5Qrcode.getCameras();
      elements.cameraSelect.innerHTML = '';

      if (devices && devices.length > 0) {
        devices.forEach((device, index) => {
          const option = document.createElement('option');
          option.value = device.id;
          option.text = device.label || `Cámara ${index + 1}`;
          elements.cameraSelect.appendChild(option);
        });
        AppState.selectedCameraId = devices[0].id;
        
        // Priorizar cámara trasera en celulares
        const backCamera = devices.find(d => 
          d.label.toLowerCase().includes('back') || 
          d.label.toLowerCase().includes('trasera') ||
          d.label.toLowerCase().includes('environment')
        );
        if (backCamera) {
          AppState.selectedCameraId = backCamera.id;
          elements.cameraSelect.value = backCamera.id;
        }
      } else {
        elements.cameraSelect.innerHTML = '<option value="">No se detectaron cámaras</option>';
      }
    } else {
      console.warn('Librería externa no cargada. Activando motor nativo.');
      await inicializarCamarasNativas();
    }
  } catch (err) {
    console.error('Error al obtener cámaras:', err);
    elements.cameraSelect.innerHTML = '<option value="">Permiso de cámara no concedido</option>';
  }
}

async function inicializarCamarasNativas() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === 'videoinput');
    elements.cameraSelect.innerHTML = '';
    
    videoDevices.forEach((device, index) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.text = device.label || `Cámara ${index + 1}`;
      elements.cameraSelect.appendChild(option);
    });

    if (videoDevices.length > 0) {
      AppState.selectedCameraId = videoDevices[0].deviceId;
    }
  } catch (e) {
    console.error('Error en cámaras nativas:', e);
  }
}

async function iniciarEscaneo() {
  if (AppState.isScanning) return;

  const cameraId = elements.cameraSelect.value || AppState.selectedCameraId;

  if (typeof Html5Qrcode !== 'undefined') {
    try {
      if (!AppState.html5QrCode) {
        AppState.html5QrCode = new Html5Qrcode('reader');
      }

      elements.cameraPlaceholder.style.display = 'none';
      elements.scannerOverlay.classList.add('active');

      const config = {
        fps: 15,
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0
      };

      const cameraParam = cameraId ? { deviceId: { exact: cameraId } } : { facingMode: "environment" };

      await AppState.html5QrCode.start(
        cameraParam,
        config,
        (decodedText) => {
          procesarCodigoDetectado(decodedText);
        },
        () => {}
      );

      AppState.isScanning = true;
      actualizarBotonesEscaneo(true);
      mostrarNotificacion('Cámara activada. Listo para leer QR.', 'info');
    } catch (err) {
      console.error('Error al iniciar con Html5Qrcode:', err);
      iniciarEscaneoNativo();
    }
  } else {
    iniciarEscaneoNativo();
  }
}

async function detenerEscaneo() {
  if (!AppState.isScanning) return;

  try {
    if (AppState.html5QrCode && AppState.html5QrCode.isScanning) {
      await AppState.html5QrCode.stop();
    }

    if (AppState.nativeVideoTrack) {
      AppState.nativeVideoTrack.stop();
      AppState.nativeVideoTrack = null;
    }

    AppState.nativeDetectorActive = false;
  } catch (err) {
    console.warn('Error al detener escáner:', err);
  } finally {
    AppState.isScanning = false;
    elements.scannerOverlay.classList.remove('active');
    elements.cameraPlaceholder.style.display = 'block';
    actualizarBotonesEscaneo(false);
  }
}

async function iniciarEscaneoNativo() {
  try {
    elements.cameraPlaceholder.style.display = 'none';
    elements.scannerOverlay.classList.add('active');

    const constraints = {
      video: AppState.selectedCameraId ? { deviceId: { exact: AppState.selectedCameraId } } : { facingMode: 'environment' }
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    AppState.nativeVideoTrack = stream.getVideoTracks()[0];

    let video = elements.readerContainer.querySelector('video');
    if (!video) {
      video = document.createElement('video');
      video.setAttribute('playsinline', 'true');
      video.setAttribute('autoplay', 'true');
      video.style.width = '100%';
      video.style.height = '100%';
      video.style.objectFit = 'cover';
      elements.readerContainer.appendChild(video);
    }
    video.srcObject = stream;
    await video.play();

    AppState.isScanning = true;
    AppState.nativeDetectorActive = true;
    actualizarBotonesEscaneo(true);

    if ('BarcodeDetector' in window) {
      const barcodeDetector = new BarcodeDetector({ formats: ['qr_code'] });
      const procesarFrame = async () => {
        if (!AppState.nativeDetectorActive) return;
        try {
          const barcodes = await barcodeDetector.detect(video);
          if (barcodes.length > 0) {
            procesarCodigoDetectado(barcodes[0].rawValue);
          }
        } catch (e) {}
        if (AppState.nativeDetectorActive) {
          requestAnimationFrame(procesarFrame);
        }
      };
      requestAnimationFrame(procesarFrame);
    }
  } catch (e) {
    console.error('Error con escáner nativo:', e);
    mostrarNotificacion('No se pudo acceder a la cámara. Permiso denegado.', 'error');
    elements.cameraPlaceholder.style.display = 'block';
    elements.scannerOverlay.classList.remove('active');
  }
}

function actualizarBotonesEscaneo(escaneando) {
  if (escaneando) {
    elements.btnStart.style.display = 'none';
    elements.btnStop.style.display = 'inline-flex';
    elements.cameraSelect.disabled = true;
  } else {
    elements.btnStart.style.display = 'inline-flex';
    elements.btnStop.style.display = 'none';
    elements.cameraSelect.disabled = false;
  }
}

// ====================================================================
// PROCESAMIENTO Y REGISTRO DEL CÓDIGO QR
// ====================================================================
function procesarCodigoDetectado(textoQr) {
  if (!textoQr || typeof textoQr !== 'string') return;
  const textoLimpio = textoQr.trim();
  if (!textoLimpio) return;

  const ahora = Date.now();
  const tiempoTranscurrido = (ahora - AppState.lastScannedTime) / 1000;

  // Enfriamiento anti-duplicados
  if (textoLimpio === AppState.lastScannedText && tiempoTranscurrido < AppState.cooldownSeconds) {
    return;
  }

  AppState.lastScannedText = textoLimpio;
  AppState.lastScannedTime = ahora;

  reproducirSonidoExito();
  registrarLectura(textoLimpio);
}

async function registrarLectura(datoQr) {
  const fechaObj = new Date();
  
  // Formato: DD/MM/AAAA
  const dia = String(fechaObj.getDate()).padStart(2, '0');
  const mes = String(fechaObj.getMonth() + 1).padStart(2, '0');
  const anio = fechaObj.getFullYear();
  const fechaStr = `${dia}/${mes}/${anio}`;

  // Formato: HH:MM:SS
  const horas = String(fechaObj.getHours()).padStart(2, '0');
  const minutos = String(fechaObj.getMinutes()).padStart(2, '0');
  const segundos = String(fechaObj.getSeconds()).padStart(2, '0');
  const horaStr = `${horas}:${minutos}:${segundos}`;

  // Mostrar último escaneo
  elements.lastScanCard.style.display = 'block';
  elements.lastScanData.textContent = datoQr;
  elements.lastScanTime.textContent = `${fechaStr} a las ${horaStr}`;

  // Objeto de registro
  const nuevoRegistro = {
    id: Date.now() + '-' + Math.random().toString(36).substr(2, 5),
    fecha: fechaStr,
    hora: horaStr,
    datoQr: datoQr,
    estado: 'enviando',
    timestamp: Date.now()
  };

  AppState.history.unshift(nuevoRegistro);
  guardarHistorialLocal();
  renderizarHistorial();

  await enviarAGoogleSheets(nuevoRegistro);
}

async function enviarAGoogleSheets(registro) {
  if (!AppState.googleSheetUrl) {
    registro.estado = 'pendiente';
    guardarHistorialLocal();
    renderizarHistorial();
    return;
  }

  const payload = {
    accion: 'registrar',
    pass: AppState.password, // Se envía la contraseña para validar la escritura
    fecha: registro.fecha,
    hora: registro.hora,
    datoQr: registro.datoQr,
    timestamp: registro.timestamp
  };

  try {
    await fetch(AppState.googleSheetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      mode: 'no-cors'
    });

    registro.estado = 'enviado';
    mostrarNotificacion(`✅ QR guardado en Sheets: ${registro.datoQr.substring(0, 20)}...`, 'success');
  } catch (error) {
    console.error('Error al enviar a Google Sheets:', error);
    registro.estado = 'error';
    reproducirSonidoError();
    mostrarNotificacion('Error de red al guardar en Google Sheets.', 'error');
  } finally {
    guardarHistorialLocal();
    renderizarHistorial();
  }
}

async function reintentarPendientes() {
  const pendientes = AppState.history.filter(r => r.estado !== 'enviado');
  if (pendientes.length === 0) {
    mostrarNotificacion('No hay registros pendientes por enviar', 'info');
    return;
  }

  mostrarNotificacion(`Reenviando ${pendientes.length} registros...`, 'info');
  for (const reg of pendientes) {
    await enviarAGoogleSheets(reg);
  }
}

// ====================================================================
// HISTORIAL LOCAL Y CSV
// ====================================================================
function guardarHistorialLocal() {
  localStorage.setItem('qr_history', JSON.stringify(AppState.history));
}

function renderizarHistorial() {
  const tbody = elements.recordsTableBody;
  tbody.innerHTML = '';

  const total = AppState.history.length;
  const pendientes = AppState.history.filter(r => r.estado !== 'enviado').length;

  elements.totalScansSpan.textContent = total;
  elements.pendingScansSpan.textContent = pendientes;

  if (total === 0) {
    elements.emptyState.style.display = 'block';
    return;
  }

  elements.emptyState.style.display = 'none';

  AppState.history.forEach((reg, index) => {
    const tr = document.createElement('tr');

    let badgeClass = 'pending';
    let estadoTexto = 'Pendiente';
    if (reg.estado === 'enviado') {
      badgeClass = 'success';
      estadoTexto = 'Guardado';
    } else if (reg.estado === 'error') {
      badgeClass = 'error';
      estadoTexto = 'Error';
    } else if (reg.estado === 'enviando') {
      badgeClass = 'pending';
      estadoTexto = 'Enviando...';
    }

    tr.innerHTML = `
      <td><strong>${total - index}</strong></td>
      <td>${escapeHtml(reg.fecha)}</td>
      <td>${escapeHtml(reg.hora)}</td>
      <td style="max-width: 250px; word-break: break-all; font-family: monospace;">${escapeHtml(reg.datoQr)}</td>
      <td><span class="badge-row ${badgeClass}">${estadoTexto}</span></td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="eliminarRegistro('${reg.id}')" title="Eliminar fila">✕</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

window.eliminarRegistro = function(id) {
  AppState.history = AppState.history.filter(r => r.id !== id);
  guardarHistorialLocal();
  renderizarHistorial();
  mostrarNotificacion('Registro eliminado del historial local', 'info');
};

function limpiarHistorial() {
  if (AppState.history.length === 0) return;
  if (confirm('¿Deseas vaciar la tabla local de esta pantalla? (Tus datos en Google Sheets seguirán intactos).')) {
    AppState.history = [];
    guardarHistorialLocal();
    renderizarHistorial();
    elements.lastScanCard.style.display = 'none';
    mostrarNotificacion('Historial local vaciado', 'info');
  }
}

function exportarACsv() {
  if (AppState.history.length === 0) {
    mostrarNotificacion('No hay datos en el historial para exportar', 'error');
    return;
  }

  let csvContent = "data:text/csv;charset=utf-8,\uFEFF";
  csvContent += "FECHA;HORA;DATO QR;ESTADO\r\n";

  AppState.history.forEach(item => {
    const datoEscapado = `"${item.datoQr.replace(/"/g, '""')}"`;
    csvContent += `${item.fecha};${item.hora};${datoEscapado};${item.estado}\r\n`;
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  const fechaHoy = new Date().toISOString().split('T')[0];
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `Registros_QR_${fechaHoy}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  mostrarNotificacion('CSV descargado con éxito', 'success');
}

// ====================================================================
// ASIGNACIÓN DE EVENTOS
// ====================================================================
function asignarEventos() {
  // Autenticación
  elements.authForm.addEventListener('submit', procesarLogin);
  elements.btnLogout.addEventListener('click', cerrarSesion);

  // Mostrar / Ocultar contraseña
  elements.btnTogglePassword.addEventListener('click', () => {
    const tipoActual = elements.authPassword.getAttribute('type');
    if (tipoActual === 'password') {
      elements.authPassword.setAttribute('type', 'text');
      elements.btnTogglePassword.textContent = '🙈';
    } else {
      elements.authPassword.setAttribute('type', 'password');
      elements.btnTogglePassword.textContent = '👁️';
    }
  });

  // Controles de cámara
  elements.btnStart.addEventListener('click', iniciarEscaneo);
  elements.btnStop.addEventListener('click', detenerEscaneo);
  elements.cameraSelect.addEventListener('change', () => {
    AppState.selectedCameraId = elements.cameraSelect.value;
    if (AppState.isScanning) {
      detenerEscaneo().then(() => iniciarEscaneo());
    }
  });

  // Opciones de audio y enfriamiento
  elements.toggleAudio.addEventListener('change', (e) => {
    AppState.audioEnabled = e.target.checked;
    localStorage.setItem('qr_audio_enabled', AppState.audioEnabled);
  });

  elements.cooldownSelect.addEventListener('change', (e) => {
    AppState.cooldownSeconds = parseInt(e.target.value, 10);
    localStorage.setItem('qr_cooldown', AppState.cooldownSeconds);
  });

  // Acciones de tabla
  elements.btnExportCsv.addEventListener('click', exportarACsv);
  elements.btnClearHistory.addEventListener('click', limpiarHistorial);
  elements.btnRetryPending.addEventListener('click', reintentarPendientes);

  // Entrada manual
  elements.btnManualInput.addEventListener('click', () => {
    elements.manualModal.classList.add('open');
    elements.inputManualCode.focus();
  });
  elements.btnCloseManual.addEventListener('click', () => {
    elements.manualModal.classList.remove('open');
    elements.inputManualCode.value = '';
  });
  elements.formManual.addEventListener('submit', (e) => {
    e.preventDefault();
    const codigo = elements.inputManualCode.value.trim();
    if (codigo) {
      elements.manualModal.classList.remove('open');
      elements.inputManualCode.value = '';
      reproducirSonidoExito();
      registrarLectura(codigo);
    }
  });

  // Cerrar modal haciendo clic afuera
  window.addEventListener('click', (e) => {
    if (e.target === elements.manualModal) {
      elements.manualModal.classList.remove('open');
    }
  });
}

function escapeHtml(texto) {
  if (!texto) return '';
  const div = document.createElement('div');
  div.innerText = texto;
  return div.innerHTML;
}
