require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');

const { pool, verificarConexion } = require('./src/db/pool');
const crearTablas = require('./src/db/schema');
const crearSessionMiddleware = require('./src/config/session');
const rutasApi = require('./src/routes');

const app = express();
const PORT = process.env.PORT || 3000;

// Render (y casi cualquier hosting moderno) pone un proxy delante del server;
// sin esto, Express nunca detecta que la conexión ya venía por HTTPS, y la
// cookie de sesión "secure" de más abajo jamás se activaría en producción.
app.set('trust proxy', 1);

// Cabeceras de seguridad HTTP básicas (X-Frame-Options, X-Content-Type-Options,
// Strict-Transport-Security, etc.). Se deja la CSP (contentSecurityPolicy)
// desactivada a propósito: el sitio usa scripts y estilos inline en casi
// todas las páginas, y la CSP por defecto de Helmet los bloquearía todos.
// Activarla bien más adelante implica mover ese código inline a archivos
// aparte — por ahora se dejan las otras protecciones, que no rompen nada.
app.use(helmet({
    contentSecurityPolicy: false
}));

// middleware para parsear JSON y servir archivos estaticos
// límite subido de 100kb a 3mb: necesario para poder guardar la foto de
// perfil como data URL (base64) directo en la base de datos, sin depender
// de un servicio externo de almacenamiento de archivos.
app.use(express.json({ limit: '3mb' }));
app.use(express.static(path.join(__dirname, 'public'))); // se asume que los archivos HTML/CSS estan en una carpeta 'public'

// middleware de sesión: el servidor recuerda quién inicio sesion mediante una cookie firmada
app.use(crearSessionMiddleware(pool));

verificarConexion();
crearTablas();

// --- Rutas de la API (una por dominio, ver src/routes/) ---
app.use('/api', rutasApi);

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
