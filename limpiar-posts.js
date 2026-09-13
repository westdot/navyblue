// limpiar-posts.js
// USO ÚNICO: borra todos los posts (y sus comentarios/likes/reposts) que NO
// pertenezcan a la cuenta indicada en USERNAME_A_CONSERVAR.
//
// Cómo correrlo:
//   1. Copia este archivo a la carpeta raíz de tu proyecto (junto a server.js)
//   2. Asegúrate de que el servidor esté DETENIDO mientras lo corres
//   3. Ejecuta: node limpiar-posts.js
//   4. Cuando termine, puedes borrar este archivo, ya cumplió su función

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const USERNAME_A_CONSERVAR = 'takato'; // <- cambia esto si en algún momento lo necesitas

const dbPath = path.join(__dirname, 'database.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('No se pudo abrir la base de datos:', err.message);
        process.exit(1);
    }
    console.log('Base de datos abierta en:', dbPath);
});

db.serialize(() => {
    db.get(`SELECT id, username FROM users WHERE username = ?`, [USERNAME_A_CONSERVAR], (err, user) => {
        if (err) {
            console.error('Error buscando la cuenta:', err.message);
            db.close();
            return;
        }
        if (!user) {
            console.log(`No existe ninguna cuenta con username "${USERNAME_A_CONSERVAR}". No se borró nada, por seguridad.`);
            db.close();
            return;
        }

        console.log(`Cuenta a conservar: "${user.username}" (id ${user.id})`);

        db.all(`SELECT id, username FROM posts WHERE user_id IS NULL OR user_id != ?`, [user.id], (err, rows) => {
            if (err) {
                console.error('Error buscando los posts a borrar:', err.message);
                db.close();
                return;
            }

            if (rows.length === 0) {
                console.log('No hay posts de otras cuentas. No hay nada que borrar.');
                db.close();
                return;
            }

            console.log(`Se van a borrar ${rows.length} post(s) que NO son de "${USERNAME_A_CONSERVAR}":`);
            rows.forEach(r => console.log(`  - post #${r.id} (username guardado: ${r.username || '(sin dueño)'})`));

            const ids = rows.map(r => r.id);
            const placeholders = ids.map(() => '?').join(',');

            db.run(`DELETE FROM comments WHERE post_id IN (${placeholders})`, ids);
            db.run(`DELETE FROM likes WHERE post_id IN (${placeholders})`, ids);
            db.run(`DELETE FROM reposts WHERE post_id IN (${placeholders})`, ids);
            db.run(`DELETE FROM posts WHERE id IN (${placeholders})`, ids, function(err) {
                if (err) {
                    console.error('Error al borrar los posts:', err.message);
                } else {
                    console.log(`\nListo: se borraron ${this.changes} post(s) (con sus comentarios/likes/reposts).`);
                    console.log(`Los posts de "${USERNAME_A_CONSERVAR}" quedaron intactos.`);
                }
                db.close();
            });
        });
    });
});
