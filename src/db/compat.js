const { pool } = require('./pool');

// --- CAPA DE COMPATIBILIDAD CON LA API DE sqlite3 ---
// Todo el resto de este archivo (más abajo) sigue escrito EXACTAMENTE igual que
// antes: usa "?" como placeholders y callbacks al estilo sqlite3
// (db.run/db.get/db.all). Este pequeño adaptador traduce esas mismas llamadas
// para que funcionen contra PostgreSQL, así no fue necesario reescribir cada
// una de las consultas del archivo.
function aPlaceholdersPg(sql) {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
}

const db = {
    // Para INSERT/UPDATE/DELETE. Imita this.lastID y this.changes de sqlite3.
    run(sql, params, callback) {
        if (typeof params === 'function') { callback = params; params = []; }
        params = params || [];

        let consulta = aPlaceholdersPg(sql);
        const esInsert = /^\s*insert/i.test(consulta);
        // Todas las tablas de este proyecto usan "id" como clave primaria,
        // así que podemos agregar RETURNING id automáticamente a cada INSERT
        // para poder devolver this.lastID como antes.
        if (esInsert && !/returning/i.test(consulta)) {
            consulta += ' RETURNING id';
        }

        pool.query(consulta, params)
            .then((resultado) => {
                const contexto = {
                    lastID: esInsert && resultado.rows[0] ? resultado.rows[0].id : undefined,
                    changes: resultado.rowCount
                };
                if (callback) callback.call(contexto, null);
            })
            .catch((err) => {
                if (callback) callback.call({}, err);
                else console.error('Error en db.run:', err.message);
            });
    },

    // Para SELECT que devuelven una sola fila (o ninguna)
    get(sql, params, callback) {
        if (typeof params === 'function') { callback = params; params = []; }
        params = params || [];
        pool.query(aPlaceholdersPg(sql), params)
            .then((resultado) => callback(null, resultado.rows[0]))
            .catch((err) => callback(err));
    },

    // Para SELECT que devuelven varias filas
    all(sql, params, callback) {
        if (typeof params === 'function') { callback = params; params = []; }
        params = params || [];
        pool.query(aPlaceholdersPg(sql), params)
            .then((resultado) => callback(null, resultado.rows))
            .catch((err) => callback(err));
    }
};

module.exports = db;
