const { Pool, types } = require('pg');

// --- CONEXIÓN A LA BASE DE DATOS (PostgreSQL en Neon) ---
// DATABASE_URL viene de una variable de entorno:
//   - En tu PC: ponla en un archivo .env (ver .env.example)
//   - En Render: Settings -> Environment -> Add Environment Variable
if (!process.env.DATABASE_URL) {
    console.error('¡Falta la variable de entorno DATABASE_URL! Revisa tu archivo .env (o la configuración en Render).');
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Neon requiere conexión con SSL
});

// PostgreSQL devuelve los resultados de COUNT(*) como texto (tipo "bigint"), para
// no perder precisión en números gigantes. Como en este proyecto ningún contador
// se acerca a ese límite, los convertimos siempre a un número normal de JS —
// si no hiciéramos esto, cosas como "liked_by_me" (0 o 1 como texto) se
// evaluarían siempre como verdaderas en el frontend.
types.setTypeParser(20, (val) => parseInt(val, 10));

function verificarConexion() {
    pool.query('SELECT NOW()')
        .then(() => console.log('Conectado a la base de datos PostgreSQL (Neon).'))
        .catch((err) => console.error('Error al conectar con la base de datos:', err.message));
}

module.exports = { pool, verificarConexion };
