const express = require('express');
const db = require('../db/compat');
const requiereSesion = require('../middleware/auth');

const router = express.Router();

// --- META DE LECTURA ANUAL ---
// Cantidad de libros marcados como "Terminado" durante un año + la meta que el
// usuario se puso para ese año (si existe). Se muestra en el muro, entre
// "Leyendo ahora" e "Insignias". Por defecto usa el año actual.
router.get('/users/:username/meta-lectura', (req, res) => {
    const { username } = req.params;
    const anio = parseInt(req.query.anio, 10) || new Date().getFullYear();

    db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, user) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        db.get(`SELECT meta FROM metas_lectura WHERE user_id = ? AND anio = ?`, [user.id, anio], (err, metaRow) => {
            if (err) return res.status(500).json({ error: 'Error en el servidor' });

            db.get(
                `SELECT COUNT(*) AS n
                 FROM shelf_items
                 JOIN shelves ON shelves.id = shelf_items.shelf_id
                 WHERE shelves.user_id = ?
                   AND LOWER(shelves.nombre) = LOWER('Terminado')
                   AND EXTRACT(YEAR FROM shelf_items.created_at) = ?`,
                [user.id, anio],
                (err, row) => {
                    if (err) return res.status(500).json({ error: 'Error en el servidor' });
                    res.json({ anio, meta: metaRow ? metaRow.meta : null, leidos: row.n });
                }
            );
        });
    });
});

// Poner/actualizar tu propia meta de libros para un año (por defecto, el actual)
router.post('/meta-lectura', requiereSesion, (req, res) => {
    const userId = req.session.user.id;
    const anio = parseInt(req.body.anio, 10) || new Date().getFullYear();
    const meta = parseInt(req.body.meta, 10);

    if (!meta || meta < 1) {
        return res.status(400).json({ error: 'Ingresa una meta válida (un número entero mayor a 0).' });
    }

    db.run(
        `INSERT INTO metas_lectura (user_id, anio, meta) VALUES (?, ?, ?)
         ON CONFLICT (user_id, anio) DO UPDATE SET meta = EXCLUDED.meta`,
        [userId, anio, meta],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Meta guardada con éxito', anio, meta });
        }
    );
});

module.exports = router;
