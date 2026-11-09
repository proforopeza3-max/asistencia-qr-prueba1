/**
 * ====================================================================
 * APLICACIÓN LECTOR QR CON ALMACENAMIENTO EN GOOGLE SHEETS
 * ====================================================================
 * Desarrollado en HTML5, JavaScript y CSS.
 * Integra autenticación con contraseña almacenada en PASSWORD!A1
 * y registro automático de lecturas QR con FECHA, HORA y DATO.
 * ====================================================================
 */

// Utilidad de almacenamiento a prueba de fallos para navegadores móviles (modo incógnito / WebView)
const safeStorage = {
  get(key, fallback = '') {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const val = window.localStorage.getItem(key);
        return val !== null ? val : fallback;
      }
    } catch (e) {
      console.warn('Acceso a localStorage restringido:', e);
    }
    return fallback;
  },
  set(key, value) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, value);
      }
    } catch (e) {
      console.warn('No se pudo guardar en localStorage:', e);
    }
  },
  remove(key) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(key);
      }
    } catch (e) {}
  }
};

function obtenerHistorialInicial() {
  try {
    const raw = safeStorage.get('qr_history', '[]');
    return JSON.parse(raw) || [];
  } catch (e) {
    return [];
  }
}

// Estado global de la aplicación
const AppState = {
  html5QrCode: null,
  isScanning: false,
  selectedCameraId: null,
  googleSheetUrl: safeStorage.get('qr_sheets_url', ''),
  password: safeStorage.get('qr_sheets_password', ''),
  isAuthenticated: safeStorage.get('qr_auth_verified', '') === 'true',
  audioEnabled: safeStorage.get('qr_audio_enabled', 'true') !== 'false',
  cooldownSeconds: parseInt(safeStorage.get('qr_cooldown', '3'), 10),
  lastScannedText: '',
  lastScannedTime: 0,
  history: obtenerHistorialInicial(),
  nativeDetectorActive: false,
  nativeVideoTrack: null
};

// ====================================================================
// ELEMENTOS DEL DOM
// ====================================================================
let elements = {};

function inicializarReferenciasDOM() {
  elements = {
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
}

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
  } catch (e) {}
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
  } catch (e) {}
}

// ====================================================================
// NOTIFICACIONES FLOTANTES (TOAST)
// ====================================================================
function mostrarNotificacion(mensaje, tipo = 'info') {
  if (!elements.toastContainer) return;
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
function iniciarAplicacion() {
  try {
    inicializarReferenciasDOM();
    asignarEventos();

    // Comprobar si ya cuenta con sesión verificada
    if (AppState.isAuthenticated && AppState.googleSheetUrl && AppState.password) {
      activarInterfazPrincipal();
    } else {
      activarPantallaLogin();
    }
  } catch (err) {
    console.error('Error durante la inicialización:', err);
    // Asegurar que la pantalla de login siempre sea visible en caso de error
    const auth = document.getElementById('auth-screen');
    if (auth) auth.style.display = 'flex';
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', iniciarAplicacion);
} else {
  iniciarAplicacion();
}

function activarPantallaLogin() {
  if (elements.authScreen) {
    elements.authScreen.style.display = 'flex';
  }
  
  if (elements.authUrl && AppState.googleSheetUrl) {
    elements.authUrl.value = AppState.googleSheetUrl;
  }
  if (elements.authPassword) elements.authPassword.value = '';
  if (elements.authErrorMsg) elements.authErrorMsg.style.display = 'none';
}

function activarInterfazPrincipal() {
  if (elements.authScreen) {
    elements.authScreen.style.display = 'none';
  }

  // Asegurar que la pantalla quede en la parte superior sin espacios vacíos
  window.scrollTo(0, 0);

  if (elements.toggleAudio) elements.toggleAudio.checked = AppState.audioEnabled;
  if (elements.cooldownSelect) elements.cooldownSelect.value = AppState.cooldownSeconds.toString();

  renderizarHistorial();
  inicializarCamaras();
}

// ====================================================================
// AUTENTICACIÓN Y VALIDACIÓN CON GOOGLE SHEETS
// ====================================================================
async function procesarLogin(e) {
  if (e) e.preventDefault();

  const urlIngresada = (elements.authUrl ? elements.authUrl.value : '').trim();
  const passIngresada = (elements.authPassword ? elements.authPassword.value : '').trim();

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

  setAuthLoading(true);
  ocultarErrorAuth();

  try {
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
      AppState.googleSheetUrl = urlIngresada;
      AppState.password = passIngresada;
      AppState.isAuthenticated = true;

      safeStorage.set('qr_sheets_url', urlIngresada);
      safeStorage.set('qr_sheets_password', passIngresada);
      safeStorage.set('qr_auth_verified', 'true');

      reproducirSonidoExito();
      mostrarNotificacion('✅ Vinculado con éxito a Google Sheets', 'success');
      activarInterfazPrincipal();
    } else {
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
  if (!elements.btnSubmitAuth) return;
  if (cargando) {
    elements.btnSubmitAuth.disabled = true;
    if (elements.authBtnSpinner) elements.authBtnSpinner.style.display = 'inline-block';
    if (elements.authBtnText) elements.authBtnText.textContent = ' Verificando credenciales...';
  } else {
    elements.btnSubmitAuth.disabled = false;
    if (elements.authBtnSpinner) elements.authBtnSpinner.style.display = 'none';
    if (elements.authBtnText) elements.authBtnText.textContent = '🔐 Conectar y Desbloquear';
  }
}

function mostrarErrorAuth(mensaje) {
  if (!elements.authErrorMsg) return;
  elements.authErrorMsg.className = 'auth-alert error';
  elements.authErrorMsg.innerHTML = `⚠️ <strong>Error:</strong> ${escapeHtml(mensaje)}`;
  elements.authErrorMsg.style.display = 'block';
}

function ocultarErrorAuth() {
  if (elements.authErrorMsg) elements.authErrorMsg.style.display = 'none';
}

function cerrarSesion() {
  if (confirm('¿Deseas desvincular esta hoja de cálculo y cerrar sesión?')) {
    detenerEscaneo();
    AppState.isAuthenticated = false;
    AppState.password = '';
    safeStorage.remove('qr_auth_verified');
    safeStorage.remove('qr_sheets_password');
    activarPantallaLogin();
    mostrarNotificacion('Sesión cerrada. Ingresa tus credenciales para volver a entrar.', 'info');
  }
}

// ====================================================================
// CONTROL DE CÁMARAS Y ESCÁNER QR
// ====================================================================
async function inicializarCamaras() {
  if (!elements.cameraSelect) return;
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
      await inicializarCamarasNativas();
    }
  } catch (err) {
    console.error('Error al obtener cámaras:', err);
    if (elements.cameraSelect) {
      elements.cameraSelect.innerHTML = '<option value="">Permiso de cámara pendiente</option>';
    }
  }
}

async function inicializarCamarasNativas() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === 'videoinput');
    if (!elements.cameraSelect) return;
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

  const cameraId = elements.cameraSelect ? elements.cameraSelect.value || AppState.selectedCameraId : AppState.selectedCameraId;

  if (typeof Html5Qrcode !== 'undefined') {
    try {
      if (!AppState.html5QrCode) {
        AppState.html5QrCode = new Html5Qrcode('reader');
      }

      if (elements.cameraPlaceholder) elements.cameraPlaceholder.style.display = 'none';
      if (elements.scannerOverlay) elements.scannerOverlay.classList.add('active');

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
      console.error('Error con Html5Qrcode:', err);
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
    if (elements.scannerOverlay) elements.scannerOverlay.classList.remove('active');
    if (elements.cameraPlaceholder) elements.cameraPlaceholder.style.display = 'block';
    actualizarBotonesEscaneo(false);
  }
}

async function iniciarEscaneoNativo() {
  try {
    if (elements.cameraPlaceholder) elements.cameraPlaceholder.style.display = 'none';
    if (elements.scannerOverlay) elements.scannerOverlay.classList.add('active');

    const constraints = {
      video: AppState.selectedCameraId ? { deviceId: { exact: AppState.selectedCameraId } } : { facingMode: 'environment' }
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    AppState.nativeVideoTrack = stream.getVideoTracks()[0];

    let video = elements.readerContainer ? elements.readerContainer.querySelector('video') : null;
    if (!video && elements.readerContainer) {
      video = document.createElement('video');
      video.setAttribute('playsinline', 'true');
      video.setAttribute('autoplay', 'true');
      video.style.width = '100%';
      video.style.height = '100%';
      video.style.objectFit = 'cover';
      elements.readerContainer.appendChild(video);
    }
    if (video) {
      video.srcObject = stream;
      await video.play();
    }

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
    if (elements.cameraPlaceholder) elements.cameraPlaceholder.style.display = 'block';
    if (elements.scannerOverlay) elements.scannerOverlay.classList.remove('active');
  }
}

function actualizarBotonesEscaneo(escaneando) {
  if (elements.btnStart && elements.btnStop) {
    if (escaneando) {
      elements.btnStart.style.display = 'none';
      elements.btnStop.style.display = 'inline-flex';
      if (elements.cameraSelect) elements.cameraSelect.disabled = true;
    } else {
      elements.btnStart.style.display = 'inline-flex';
      elements.btnStop.style.display = 'none';
      if (elements.cameraSelect) elements.cameraSelect.disabled = false;
    }
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
  
  const dia = String(fechaObj.getDate()).padStart(2, '0');
  const mes = String(fechaObj.getMonth() + 1).padStart(2, '0');
  const anio = fechaObj.getFullYear();
  const fechaStr = `${dia}/${mes}/${anio}`;

  const horas = String(fechaObj.getHours()).padStart(2, '0');
  const minutos = String(fechaObj.getMinutes()).padStart(2, '0');
  const segundos = String(fechaObj.getSeconds()).padStart(2, '0');
  const horaStr = `${horas}:${minutos}:${segundos}`;

  if (elements.lastScanCard) elements.lastScanCard.style.display = 'block';
  if (elements.lastScanData) elements.lastScanData.textContent = datoQr;
  if (elements.lastScanTime) elements.lastScanTime.textContent = `${fechaStr} a las ${horaStr}`;

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
    pass: AppState.password,
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
    mostrarNotificacion(`✅ Guardado: ${registro.datoQr.substring(0, 18)}...`, 'success');
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
  safeStorage.set('qr_history', JSON.stringify(AppState.history));
}

function renderizarHistorial() {
  if (!elements.recordsTableBody) return;
  const tbody = elements.recordsTableBody;
  tbody.innerHTML = '';

  const total = AppState.history.length;
  const pendientes = AppState.history.filter(r => r.estado !== 'enviado').length;

  if (elements.totalScansSpan) elements.totalScansSpan.textContent = total;
  if (elements.pendingScansSpan) elements.pendingScansSpan.textContent = pendientes;

  if (total === 0) {
    if (elements.emptyState) elements.emptyState.style.display = 'block';
    return;
  }

  if (elements.emptyState) elements.emptyState.style.display = 'none';

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
  mostrarNotificacion('Registro eliminado', 'info');
};

function limpiarHistorial() {
  if (AppState.history.length === 0) return;
  if (confirm('¿Deseas vaciar la tabla local de esta pantalla? (Tus datos en Google Sheets seguirán intactos).')) {
    AppState.history = [];
    guardarHistorialLocal();
    renderizarHistorial();
    if (elements.lastScanCard) elements.lastScanCard.style.display = 'none';
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
  if (elements.authForm) elements.authForm.addEventListener('submit', procesarLogin);
  if (elements.btnLogout) elements.btnLogout.addEventListener('click', cerrarSesion);

  if (elements.btnTogglePassword && elements.authPassword) {
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
  }

  if (elements.btnStart) elements.btnStart.addEventListener('click', iniciarEscaneo);
  if (elements.btnStop) elements.btnStop.addEventListener('click', detenerEscaneo);

  if (elements.cameraSelect) {
    elements.cameraSelect.addEventListener('change', () => {
      AppState.selectedCameraId = elements.cameraSelect.value;
      if (AppState.isScanning) {
        detenerEscaneo().then(() => iniciarEscaneo());
      }
    });
  }

  if (elements.toggleAudio) {
    elements.toggleAudio.addEventListener('change', (e) => {
      AppState.audioEnabled = e.target.checked;
      safeStorage.set('qr_audio_enabled', AppState.audioEnabled ? 'true' : 'false');
    });
  }

  if (elements.cooldownSelect) {
    elements.cooldownSelect.addEventListener('change', (e) => {
      AppState.cooldownSeconds = parseInt(e.target.value, 10);
      safeStorage.set('qr_cooldown', AppState.cooldownSeconds.toString());
    });
  }

  if (elements.btnExportCsv) elements.btnExportCsv.addEventListener('click', exportarACsv);
  if (elements.btnClearHistory) elements.btnClearHistory.addEventListener('click', limpiarHistorial);
  if (elements.btnRetryPending) elements.btnRetryPending.addEventListener('click', reintentarPendientes);

  if (elements.btnManualInput) {
    elements.btnManualInput.addEventListener('click', () => {
      if (elements.manualModal) elements.manualModal.classList.add('open');
      if (elements.inputManualCode) elements.inputManualCode.focus();
    });
  }

  if (elements.btnCloseManual) {
    elements.btnCloseManual.addEventListener('click', () => {
      if (elements.manualModal) elements.manualModal.classList.remove('open');
      if (elements.inputManualCode) elements.inputManualCode.value = '';
    });
  }

  if (elements.formManual) {
    elements.formManual.addEventListener('submit', (e) => {
      e.preventDefault();
      const codigo = elements.inputManualCode ? elements.inputManualCode.value.trim() : '';
      if (codigo) {
        if (elements.manualModal) elements.manualModal.classList.remove('open');
        if (elements.inputManualCode) elements.inputManualCode.value = '';
        reproducirSonidoExito();
        registrarLectura(codigo);
      }
    });
  }

  window.addEventListener('click', (e) => {
    if (elements.manualModal && e.target === elements.manualModal) {
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
