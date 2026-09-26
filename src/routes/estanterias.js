const express = require('express');
const db = require('../db/compat');
const requiereSesion = require('../middleware/auth');

const router = express.Router();

// --- ESTANTERÍAS / COLECCIONES DE LIBROS ---

// Trae las estanterías (con sus libros) de CUALQUIER usuario, por nombre — pública.
// Si el que pregunta es el dueño y todavía no tiene ninguna, le creamos 3 por defecto.
router.get('/users/:username/shelves', (req, res) => {
    const { username } = req.params;
    const miId = req.session.user ? req.session.user.id : null;

    db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, user) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        const traerEstanterias = () => {
            db.all(`SELECT id, nombre FROM shelves WHERE user_id = ? ORDER BY id ASC`, [user.id], (err, estantes) => {
                if (err) return res.status(500).json({ error: 'Error en el servidor' });
                if (estantes.length === 0) return res.json({ shelves: [] });

                let pendientes = estantes.length;
                estantes.forEach(estante => {
                    db.all(
                        `SELECT id, libro_titulo, autor, portada_url FROM shelf_items WHERE shelf_id = ? ORDER BY id DESC`,
                        [estante.id],
                        (err, libros) => {
                            estante.libros = err ? [] : libros;
                            pendientes--;
                            if (pendientes === 0) res.json({ shelves: estantes });
                        }
                    );
                });
            });
        };

        const esDueno = miId === user.id;
        if (!esDueno) return traerEstanterias();

        db.get(`SELECT COUNT(*) AS n FROM shelves WHERE user_id = ?`, [user.id], (err, row) => {
            if (err) return res.status(500).json({ error: 'Error en el servidor' });
            if (row.n > 0) return traerEstanterias();

            const porDefecto = ['Leyendo', 'Quiero Leer', 'Terminado', 'DNF'];
            let creadas = 0;
            porDefecto.forEach(nombre => {
                db.run(`INSERT INTO shelves (user_id, nombre) VALUES (?, ?)`, [user.id, nombre], () => {
                    creadas++;
                    if (creadas === porDefecto.length) traerEstanterias();
                });
            });
        });
    });
});

// Crear una estantería nueva (propia)
router.post('/shelves', requiereSesion, (req, res) => {
    const { nombre } = req.body;
    if (!nombre || !nombre.trim()) {
        return res.status(400).json({ error: 'La estantería necesita un nombre' });
    }
    db.run(`INSERT INTO shelves (user_id, nombre) VALUES (?, ?)`, [req.session.user.id, nombre.trim()], function(err) {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        res.status(201).json({ message: 'Estantería creada', shelfId: this.lastID });
    });
});

// Renombrar una estantería propia
router.put('/shelves/:id', requiereSesion, (req, res) => {
    const { id } = req.params;
    const { nombre } = req.body;
    if (!nombre || !nombre.trim()) {
        return res.status(400).json({ error: 'La estantería necesita un nombre' });
    }
    db.get(`SELECT user_id FROM shelves WHERE id = ?`, [id], (err, estante) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!estante) return res.status(404).json({ error: 'Estantería no encontrada' });
        if (estante.user_id !== req.session.user.id) {
            return res.status(403).json({ error: 'No puedes modificar estanterías de otros usuarios' });
        }
        db.run(`UPDATE shelves SET nombre = ? WHERE id = ?`, [nombre.trim(), id], (err) => {
            if (err) return res.status(500).json({ error: 'Error en el servidor' });
            res.json({ message: 'Estantería actualizada' });
        });
    });
});

// Eliminar una estantería propia (y los libros que tenía adentro)
router.delete('/shelves/:id', requiereSesion, (req, res) => {
    const { id } = req.params;
    db.get(`SELECT user_id FROM shelves WHERE id = ?`, [id], (err, estante) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!estante) return res.status(404).json({ error: 'Estantería no encontrada' });
        if (estante.user_id !== req.session.user.id) {
            return res.status(403).json({ error: 'No puedes eliminar estanterías de otros usuarios' });
        }
        db.run(`DELETE FROM shelves WHERE id = ?`, [id], (err) => {
            if (err) return res.status(500).json({ error: 'Error en el servidor' });
            db.run(`DELETE FROM shelf_items WHERE shelf_id = ?`, [id]);
            res.json({ message: 'Estantería eliminada' });
        });
    });
});

// Agregar un libro a una estantería propia
router.post('/shelves/:id/items', requiereSesion, (req, res) => {
    const { id } = req.params;
    const { libro_titulo, autor, portada_url } = req.body;

    if (!libro_titulo || !autor) {
        return res.status(400).json({ error: 'Completa al menos título y autor' });
    }

    db.get(`SELECT user_id FROM shelves WHERE id = ?`, [id], (err, estante) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!estante) return res.status(404).json({ error: 'Estantería no encontrada' });
        if (estante.user_id !== req.session.user.id) {
            return res.status(403).json({ error: 'No puedes agregar libros a estanterías de otros usuarios' });
        }
        db.run(
            `INSERT INTO shelf_items (shelf_id, libro_titulo, autor, portada_url) VALUES (?, ?, ?, ?)`,
            [id, libro_titulo, autor, portada_url || null],
            function(err) {
                if (err) return res.status(500).json({ error: 'Error en el servidor' });
                res.status(201).json({ message: 'Libro agregado', itemId: this.lastID });
            }
        );
    });
});

// Modificar un libro de una estantería propia (título, autor y/o portada)
router.put('/shelf-items/:id', requiereSesion, (req, res) => {
    const { id } = req.params;
    const { libro_titulo, autor, portada_url } = req.body;

    if (!libro_titulo || !autor) {
        return res.status(400).json({ error: 'Completa al menos título y autor' });
    }

    db.get(
        `SELECT shelves.user_id FROM shelf_items JOIN shelves ON shelves.id = shelf_items.shelf_id WHERE shelf_items.id = ?`,
        [id],
        (err, fila) => {
            if (err) return res.status(500).json({ error: 'Error en el servidor' });
            if (!fila) return res.status(404).json({ error: 'Libro no encontrado' });
            if (fila.user_id !== req.session.user.id) {
                return res.status(403).json({ error: 'No puedes modificar estanterías de otros usuarios' });
            }
            db.run(
                `UPDATE shelf_items SET libro_titulo = ?, autor = ?, portada_url = ? WHERE id = ?`,
                [libro_titulo, autor, portada_url || null, id],
                (err) => {
                    if (err) return res.status(500).json({ error: 'Error en el servidor' });
                    res.json({ message: 'Libro actualizado' });
                }
            );
        }
    );
});

// Quitar un libro de una estantería propia
router.delete('/shelf-items/:id', requiereSesion, (req, res) => {
    const { id } = req.params;
    db.get(
        `SELECT shelves.user_id FROM shelf_items JOIN shelves ON shelves.id = shelf_items.shelf_id WHERE shelf_items.id = ?`,
        [id],
        (err, fila) => {
            if (err) return res.status(500).json({ error: 'Error en el servidor' });
            if (!fila) return res.status(404).json({ error: 'Libro no encontrado' });
            if (fila.user_id !== req.session.user.id) {
                return res.status(403).json({ error: 'No puedes modificar estanterías de otros usuarios' });
            }
            db.run(`DELETE FROM shelf_items WHERE id = ?`, [id], (err) => {
                if (err) return res.status(500).json({ error: 'Error en el servidor' });
                res.json({ message: 'Libro eliminado de la estantería' });
            });
        }
    );
});

module.exports = router;
