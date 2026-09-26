const express = require('express');
const db = require('../db/compat');
const requiereSesion = require('../middleware/auth');

const router = express.Router();

// --- RUTAS DE PROGRESO DE LECTURA ---

// Lecturas en curso de CUALQUIER usuario — pública
router.get('/users/:username/lecturas', (req, res) => {
    const { username } = req.params;
    db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, user) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        db.all(
            `SELECT id, libro_titulo, autor, portada_url, pagina_actual, paginas_totales, updated_at
             FROM lecturas_en_curso WHERE user_id = ? ORDER BY updated_at DESC`,
            [user.id],
            (err, rows) => {
                if (err) return res.status(500).json({ error: 'Error en el servidor' });
                res.json({ lecturas: rows });
            }
        );
    });
});

// Empezar una lectura nueva
router.post('/lecturas', requiereSesion, (req, res) => {
    const { libro_titulo, autor, portada_url, paginas_totales } = req.body;
    const totales = parseInt(paginas_totales, 10);

    if (!libro_titulo || !autor || !totales || totales < 1) {
        return res.status(400).json({ error: 'Completa título, autor y el total de páginas' });
    }

    db.run(
        `INSERT INTO lecturas_en_curso (user_id, libro_titulo, autor, portada_url, pagina_actual, paginas_totales) VALUES (?, ?, ?, ?, 0, ?)`,
        [req.session.user.id, libro_titulo, autor, portada_url || null, totales],
        function(err) {
            if (err) return res.status(500).json({ error: 'Error en el servidor' });
            res.status(201).json({ message: 'Lectura agregada', lecturaId: this.lastID });
        }
    );
});

// Actualizar la página actual (y, si se pide, compartirlo como post automático)
router.put('/lecturas/:id', requiereSesion, (req, res) => {
    const { id } = req.params;
    const { pagina_actual, compartir } = req.body;
    const pagina = parseInt(pagina_actual, 10);

    if (isNaN(pagina) || pagina < 0) {
        return res.status(400).json({ error: 'Página inválida' });
    }

    db.get(`SELECT * FROM lecturas_en_curso WHERE id = ?`, [id], (err, lectura) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!lectura) return res.status(404).json({ error: 'Lectura no encontrada' });
        if (lectura.user_id !== req.session.user.id) {
            return res.status(403).json({ error: 'No puedes modificar lecturas de otros usuarios' });
        }
        if (pagina > lectura.paginas_totales) {
            return res.status(400).json({ error: `Esa página supera el total del libro (${lectura.paginas_totales})` });
        }

        db.run(
            `UPDATE lecturas_en_curso SET pagina_actual = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [pagina, id],
            (err) => {
                if (err) return res.status(500).json({ error: 'Error en el servidor' });

                if (compartir) {
                    const { username } = req.session.user;
                    const contenido = `📖 Voy en la página ${pagina} de ${lectura.paginas_totales} de "${lectura.libro_titulo}"`;
                    db.run(
                        `INSERT INTO posts (user_id, username, content, tag) VALUES (?, ?, ?, ?)`,
                        [req.session.user.id, username, contenido, lectura.autor]
                    );
                }

                res.json({ message: 'Progreso actualizado', pagina_actual: pagina });
            }
        );
    });
});

// Quitar una lectura en curso (terminada o abandonada)
router.delete('/lecturas/:id', requiereSesion, (req, res) => {
    const { id } = req.params;
    db.get(`SELECT user_id FROM lecturas_en_curso WHERE id = ?`, [id], (err, lectura) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!lectura) return res.status(404).json({ error: 'Lectura no encontrada' });
        if (lectura.user_id !== req.session.user.id) {
            return res.status(403).json({ error: 'No puedes eliminar lecturas de otros usuarios' });
        }
        db.run(`DELETE FROM lecturas_en_curso WHERE id = ?`, [id], (err) => {
            if (err) return res.status(500).json({ error: 'Error en el servidor' });
            res.json({ message: 'Lectura eliminada' });
        });
    });
});

module.exports = router;
