const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);

// middleware de sesión: el servidor recuerda quién inicio sesion mediante una cookie firmada.
// Las sesiones se guardan en una tabla de esta misma base de datos (en vez del
// almacén en memoria que trae express-session por defecto). Ese almacén por
// defecto NO está pensado para producción: pierde a todos los usuarios logueados
// cada vez que Render reinicia el servidor, y no funcionaría si algún día corres
// más de una instancia del servidor a la vez. connect-pg-simple crea sola la
// tabla "session" la primera vez que arranca (createTableIfMissing).
function crearSessionMiddleware(pool) {
    return session({
        store: new PgSession({
            pool,
            tableName: 'session',
            createTableIfMissing: true
        }),
        secret: process.env.SESSION_SECRET || 'cambia-esto-por-una-frase-larga-y-secreta',
        resave: false,
        saveUninitialized: false,
        cookie: {
            maxAge: 1000 * 60 * 60 * 24, // la sesión dura 24 horas
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production', // true en Render (necesita NODE_ENV=production en las variables de entorno), false en tu PC para que sigas pudiendo probar por http local
            sameSite: 'lax'
        }
    });
}

module.exports = crearSessionMiddleware;
