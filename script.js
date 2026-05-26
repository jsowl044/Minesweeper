let filas = 0;
let columnas = 0;
let totalMinas = 0;
let tablero = [];
let modoBanderas = false;
let banderasColocadas = 0;
let estadoJuego = 'waiting';
let socket;
let salaId = null;
let esEspectador = false;
let pendingRoomJoin = null;

function inicializarConexion() {
    // Connect to WebSocket server using the page's host when possible.
    // Falls back to localhost when opened via file:// or when hostname is empty.
    const wsScheme = (location.protocol === 'https:') ? 'wss:' : 'ws:';
    const host = (location.hostname && location.hostname.length > 0) ? location.hostname : 'localhost';
    socket = new WebSocket(wsScheme + '//' + host + ':8080');

    socket.addEventListener('open', () => {
        console.log('Conectado al servidor WebSocket');
        document.getElementById('resultado').textContent = 'Conectado al servidor';
        try {
            const params = new URLSearchParams(window.location.search);
            const room = params.get('room');
            if (room) {
                salaId = room;
                pendingRoomJoin = room;
                enviarServidor({ action: 'join', payload: { roomId: salaId } });
                document.getElementById('resultado').textContent = 'Intentando unirse como espectador a ' + salaId;
            }
        } catch (e) {
            console.warn('Error al procesar parámetros de URL:', e);
        }
    });

    socket.addEventListener('message', (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'estado') {
            if (pendingRoomJoin) {
                esEspectador = true;
                pendingRoomJoin = null;
            }
            renderizarEstado(data.payload);
        } else if (data.type === 'error') {
            if (data.payload && pendingRoomJoin) {
                document.getElementById('resultado').textContent = 'No se encontró la sala: ' + pendingRoomJoin + '. Puedes crear un nuevo juego.';
                pendingRoomJoin = null;
                salaId = null;
                esEspectador = false;
                actualizarRoomInfo();
            }
        }
    });

    socket.addEventListener('close', () => {
        console.log('Conexión WebSocket cerrada');
        document.getElementById('resultado').textContent = 'Servidor desconectado';
        estadoJuego = 'disconnected';
    });

    socket.addEventListener('error', () => {
        console.warn('Error en la conexión WebSocket');
        document.getElementById('resultado').textContent = 'Error de conexión con el servidor';
    });
}

function enviarServidor(mensaje) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(mensaje));
    } else {
        console.error('[Cliente] WebSocket no está abierto. Estado:', socket ? socket.readyState : 'socket no existe');
        alert('No se puede conectar con el servidor WebSocket. Asegúrate de que esté en ejecución.');
    }
}

function validarEntradas() {
    filas = parseInt(document.getElementById('height').value, 10);
    columnas = parseInt(document.getElementById('width').value, 10);
    totalMinas = parseInt(document.getElementById('minas').value, 10);

    if (isNaN(filas) || isNaN(columnas) || isNaN(totalMinas)) {
        alert('Por favor, ingresa valores válidos para el tamaño del tablero y el número de minas.');
        return false;
    }

    if (filas <= 1 || columnas <= 1 || totalMinas <= 0) {
        alert('El tamaño del tablero debe ser mayor que 1x1 y el número de minas debe ser mayor que 0.');
        return false;
    }

    if (totalMinas >= filas * columnas) {
        alert('El número de minas debe ser menor que el total de celdas.');
        return false;
    }

    return true;
}

function crearTablero() {
    if (!validarEntradas()) {
        return;
    }

    modoBanderas = false;
    banderasColocadas = 0;
    actualizarContadorBanderas();
    actualizarToggleBandera();
    document.getElementById('resultado').textContent = '';

    if (esEspectador) {
        document.getElementById('resultado').textContent = 'No puedes iniciar un juego desde un link de espectador. Abre la página sin ?room=ID para jugar.';
        return;
    }

    enviarServidor({
        action: 'newGame',
        payload: {
            width: columnas,
            height: filas,
            minas: totalMinas,
        },
    });
}

function renderizarEstado(payload) {
    if (payload.roomId) {
        salaId = payload.roomId;
    }

    filas = payload.height;
    columnas = payload.width;
    totalMinas = payload.minas;
    tablero = payload.tablero;
    banderasColocadas = payload.banderasColocadas || 0;
    estadoJuego = payload.estado || 'playing';

    const restartButton = document.getElementById('restartButton');
    if (restartButton) {
        restartButton.hidden = esEspectador || estadoJuego === 'playing' || !salaId;
    }

    actualizarContadorBanderas();
    actualizarRoomInfo();
    renderizarResultado(estadoJuego);
    graficarTablero();
}

function actualizarRoomInfo() {
    const roomIdText = document.getElementById('roomIdText');
    const copyButton = document.getElementById('copyRoomIdButton');
    const roomTip = document.getElementById('roomTip');
    const gameForm = document.getElementById('gameForm');

    if (!roomIdText || !copyButton || !roomTip || !gameForm) return;

    if (salaId) {
        roomIdText.textContent = 'Sala: ' + salaId;
        copyButton.disabled = false;
        if (esEspectador) {
            gameForm.innerHTML = '<p>Modo espectador</p>';
            copyButton.hidden = true;
        }
    } else {
        roomIdText.textContent = 'Sala: —';
        copyButton.disabled = true;
    }
}


function copiarRoomId() {
    if (!salaId) return;
    const url = window.location.origin + window.location.pathname + '?room=' + salaId;
    navigator.clipboard.writeText(url).then(() => {
        const roomTip = document.getElementById('roomTip');
        if (roomTip) {
            roomTip.textContent = 'Enlace copiado: ' + url;
        }
    }).catch(() => {
        alert('No se pudo copiar el enlace automáticamente. Copia manualmente: ' + url);
    });
}

function reiniciarJuego() {
    if (!salaId || esEspectador) return;
    enviarServidor({ action: 'restart', payload: { roomId: salaId } });
}

function renderizarResultado(estado) {
    const resultadoDiv = document.getElementById('resultado');
    if (estado === 'won') {
        resultadoDiv.textContent = '¡Ganaste!';
    } else if (estado === 'lost') {
        resultadoDiv.textContent = '¡Perdiste!';
    } else if (estado === 'playing') {
        resultadoDiv.textContent = '';
    }
}

function graficarTablero() {
    const contenedor = document.getElementById('tablero');
    contenedor.innerHTML = '';
    contenedor.style.gridTemplateColumns = `repeat(${columnas}, 40px)`;

    for (let i = 0; i < filas; i++) {
        for (let j = 0; j < columnas; j++) {
            const celda = document.createElement('div');
            celda.classList.add('celda');
            celda.dataset.fila = i;
            celda.dataset.columna = j;
            const estadoCelda = tablero[i][j];

            if (estadoCelda.revelada) {
                celda.classList.add('revelada');
                if (estadoCelda.tieneMina) {
                    celda.classList.add('mina');
                } else if (estadoCelda.minasAlrededor > 0) {
                    celda.textContent = estadoCelda.minasAlrededor;
                }
            } else if (estadoCelda.tieneBandera) {
                celda.textContent = '🚩';
                celda.classList.add('bandera');
            }

            celda.addEventListener('click', manejarCeldaClick);
            contenedor.appendChild(celda);
        }
    }
}

function manejarCeldaClick(event) {
    if (estadoJuego !== 'playing') {
        return;
    }

    if (esEspectador) {
        return;
    }

    const celdaElemento = event.currentTarget;
    const fila = parseInt(celdaElemento.dataset.fila, 10);
    const columna = parseInt(celdaElemento.dataset.columna, 10);

    if (modoBanderas) {
        enviarServidor({
            action: 'flag',
            payload: { fila, columna },
        });
    } else {
        enviarServidor({
            action: 'reveal',
            payload: { fila, columna },
        });
    }
}

function alternarModoBandera() {
    modoBanderas = !modoBanderas;
    actualizarToggleBandera();
}

function actualizarToggleBandera() {
    const boton = document.getElementById('toggleBandera');
    if (!boton) return;
    boton.classList.toggle('activo', modoBanderas);
}

function actualizarContadorBanderas() {
    const contador = document.getElementById('contadorBanderas');
    if (contador) {
        contador.textContent = `Banderas: ${banderasColocadas}`;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const startButton = document.getElementById('startButton');
    const toggleButton = document.getElementById('toggleBandera');
    const copyButton = document.getElementById('copyRoomIdButton');
    const restartButton = document.getElementById('restartButton');

    startButton.addEventListener('click', crearTablero);
    toggleButton.addEventListener('click', alternarModoBandera);
    if (copyButton) {
        copyButton.addEventListener('click', copiarRoomId);
    }
    if (restartButton) {
        restartButton.addEventListener('click', reiniciarJuego);
    }

    actualizarToggleBandera();
    actualizarRoomInfo();
    inicializarConexion();
});
