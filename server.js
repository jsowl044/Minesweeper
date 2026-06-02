const http = require('http');
const WebSocket = require('ws');

const port = 8000;

function crearTablero(width, height, minas) {
  const tablero = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({
      tieneMina: false,
      revelada: false,
      tieneBandera: false,
      minasAlrededor: 0,
    }))
  );

  let minasColocadas = 0;
  while (minasColocadas < minas) {
    const fila = Math.floor(Math.random() * height);
    const columna = Math.floor(Math.random() * width);
    if (!tablero[fila][columna].tieneMina) {
      tablero[fila][columna].tieneMina = true;
      minasColocadas += 1;
      actualizarCeldasAlrededor(tablero, fila, columna, width, height);
    }
  }

  return tablero;
}

function actualizarCeldasAlrededor(tablero, fila, columna, width, height) {
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const filaNueva = fila + i;
      const columnaNueva = columna + j;
      if (
        filaNueva >= 0 &&
        filaNueva < height &&
        columnaNueva >= 0 &&
        columnaNueva < width &&
        !(i === 0 && j === 0)
      ) {
        tablero[filaNueva][columnaNueva].minasAlrededor += 1;
      }
    }
  }
}

function revelarCeldas(tablero, fila, columna, width, height) {
  const pila = [[fila, columna]];

  while (pila.length) {
    const [f, c] = pila.pop();
    const celda = tablero[f][c];
    if (celda.revelada || celda.tieneBandera) continue;

    celda.revelada = true;

    if (celda.minasAlrededor === 0 && !celda.tieneMina) {
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          const nf = f + i;
          const nc = c + j;
          if (
            nf >= 0 &&
            nf < height &&
            nc >= 0 &&
            nc < width &&
            !(i === 0 && j === 0)
          ) {
            const vecino = tablero[nf][nc];
            if (!vecino.revelada && !vecino.tieneBandera) {
              pila.push([nf, nc]);
            }
          }
        }
      }
    }
  }
}

function verificarVictoria(tablero, width, height) {
  for (let i = 0; i < height; i++) {
    for (let j = 0; j < width; j++) {
      const celda = tablero[i][j];
      if (!celda.tieneMina && !celda.revelada) {
        return false;
      }
    }
  }
  return true;
}

function tableroParaCliente(tablero, width, height) {
  return tablero.map((fila) =>
    fila.map((celda) => ({
      revelada: celda.revelada,
      tieneBandera: celda.tieneBandera,
      minasAlrededor: celda.revelada ? celda.minasAlrededor : 0,
      tieneMina: celda.revelada && celda.tieneMina,
    }))
  );
}

function crearJuego(width, height, minas) {
  return {
    width,
    height,
    minas,
    tablero: crearTablero(width, height, minas),
    estado: 'playing',
    banderasColocadas: 0,
  };
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Minesweeper WebSocket server is running');
});

const wss = new WebSocket.Server({ server });
const juegosPorCliente = new Map();
const gamesById = new Map(); 
const espectadoresPorCliente = new Map(); 

function enviarEstado(ws, juego) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(
    JSON.stringify({
      type: 'estado',
      payload: {
        roomId: juego.id,
        width: juego.width,
        height: juego.height,
        minas: juego.minas,
        estado: juego.estado,
        banderasColocadas: juego.banderasColocadas,
        tablero: tableroParaCliente(juego.tablero, juego.width, juego.height),
      },
    })
  );
}

function generarIdJuego() {
  return 'partida-' + Math.random().toString(36).slice(2, 9);
}

function broadcastGameById(gameId) {
  const entry = gamesById.get(gameId);
  if (!entry) return;
  const { juego, owner, spectators } = entry;
  enviarEstado(owner, juego);
  for (const spec of spectators) {
    if (spec.readyState === WebSocket.OPEN) {
      enviarEstado(spec, juego);
    }
  }
}

wss.on('connection', (ws) => {
  console.log('Cliente conectado');

  ws.send(JSON.stringify({ type: 'welcome', payload: { message: 'Conectado. Envia newGame para iniciar un nuevo juego.' } }));

  ws.on('message', (message) => {
    let data;
    try {
      data = JSON.parse(message.toString());
    } catch (error) {
      console.warn('Mensaje WebSocket inválido:', message.toString());
      return;
    }

    if (data.action === 'newGame') {
      const { width, height, minas } = data.payload || {};
      if (
        Number.isInteger(width) &&
        Number.isInteger(height) &&
        Number.isInteger(minas) &&
        width > 1 &&
        height > 1 &&
        minas > 0 &&
        minas < width * height
      ) {
        const nuevoJuego = crearJuego(width, height, minas);
        nuevoJuego.id = generarIdJuego();
        juegosPorCliente.set(ws, nuevoJuego);
        gamesById.set(nuevoJuego.id, { juego: nuevoJuego, owner: ws, spectators: new Set() });
        console.log('[Servidor] Juego creado:', nuevoJuego.id);
        enviarEstado(ws, nuevoJuego);
      }
      return;
    }

    if (data.action === 'join') {
      const { roomId } = data.payload || {};
      const entry = gamesById.get(roomId);
      if (!entry) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Sala no encontrada' } }));
        return;
      }
      entry.spectators.add(ws);
      espectadoresPorCliente.set(ws, roomId);
      enviarEstado(ws, entry.juego);
      return;
    }

    if (data.action === 'restart') {
      const juegoActual = juegosPorCliente.get(ws);
      if (!juegoActual) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'No hay juego activo para reiniciar.' } }));
        return;
      }

      const nuevoJuego = crearJuego(juegoActual.width, juegoActual.height, juegoActual.minas);
      nuevoJuego.id = juegoActual.id;
      juegosPorCliente.set(ws, nuevoJuego);
      const entry = gamesById.get(nuevoJuego.id);
      if (entry) entry.juego = nuevoJuego;
      broadcastGameById(nuevoJuego.id);
      return;
    }

    const juegoActual = juegosPorCliente.get(ws);

    if (!juegoActual) {
      if (espectadoresPorCliente.has(ws)) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'No permitido: eres espectador.' } }));
        const gid = espectadoresPorCliente.get(ws);
        const entry = gamesById.get(gid);
        if (entry) enviarEstado(ws, entry.juego);
        return;
      }
      ws.send(JSON.stringify({ type: 'error', payload: { message: 'No hay juego activo. Crea un juego primero.' } }));
      return;
    }

    if (juegoActual.estado !== 'playing') {
      broadcastGameById(juegoActual.id);
      return;
    }

    if (data.action === 'reveal') {
      const { fila, columna } = data.payload || {};
      const celda = juegoActual.tablero[fila]?.[columna];
      if (!celda || celda.revelada || celda.tieneBandera) {
        broadcastGameById(juegoActual.id);
        return;
      }

      if (celda.tieneMina) {
        celda.revelada = true;
        juegoActual.estado = 'lost';
      } else {
        revelarCeldas(juegoActual.tablero, fila, columna, juegoActual.width, juegoActual.height);
        if (verificarVictoria(juegoActual.tablero, juegoActual.width, juegoActual.height)) {
          juegoActual.estado = 'won';
        }
      }
      broadcastGameById(juegoActual.id);
      return;
    }

    if (data.action === 'flag') {
      const { fila, columna } = data.payload || {};
      const celda = juegoActual.tablero[fila]?.[columna];
      if (!celda || celda.revelada) {
        broadcastGameById(juegoActual.id);
        return;
      }

      celda.tieneBandera = !celda.tieneBandera;
      juegoActual.banderasColocadas += celda.tieneBandera ? 1 : -1;
      broadcastGameById(juegoActual.id);
      return;
    }
  });

  ws.on('close', () => {
    console.log('Cliente desconectado');
    // If owner disconnects, notify and remove game
    if (juegosPorCliente.has(ws)) {
      const juego = juegosPorCliente.get(ws);
      const entry = gamesById.get(juego.id);
      if (entry) {
        for (const spec of entry.spectators) {
          if (spec.readyState === WebSocket.OPEN) {
            spec.send(JSON.stringify({ type: 'error', payload: { message: 'El propietario se desconectó. La sala se cerró.' } }));
            espectadoresPorCliente.delete(spec);
          }
        }
        gamesById.delete(juego.id);
      }
      juegosPorCliente.delete(ws);
      return;
    }

    if (espectadoresPorCliente.has(ws)) {
      const gid = espectadoresPorCliente.get(ws);
      const entry = gamesById.get(gid);
      if (entry) entry.spectators.delete(ws);
      espectadoresPorCliente.delete(ws);
      return;
    }


    juegosPorCliente.delete(ws);
    espectadoresPorCliente.delete(ws);
  });
});

server.listen(port, () => {
  console.log(`Servidor HTTP y WebSocket escuchando en http://localhost:${port}`);
});
