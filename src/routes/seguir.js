const express = require('express');
const db = require('../db/compat');
const requiereSesion = require('../middleware/auth');
const { crearNotificacion } = require('../services/notificaciones');

const router = express.Router();

// --- RUTAS DE SEGUIR (asimétrico, sin permiso — separado de amigos) ---

// Seguir / dejar de seguir a alguien (toggle)
router.post('/follow/:username', requiereSesion, (req, res) => {
    const miId = req.session.user.id;
    const { username } = req.params;

    if (username === req.session.user.username) {
        return res.status(400).json({ error: 'No puedes seguirte a ti mismo' });
    }

    db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, otro) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!otro) return res.status(404).json({ error: 'Usuario no encontrado' });

        db.get(`SELECT id FROM follows WHERE follower_id = ? AND followed_id = ?`, [miId, otro.id], (err, existente) => {
            if (err) return res.status(500).json({ error: 'Error en el servidor' });

            if (existente) {
                db.run(`DELETE FROM follows WHERE id = ?`, [existente.id], (err) => {
                    if (err) return res.status(500).json({ error: 'Error en el servidor' });
                    res.json({ siguiendo: false });
                });
            } else {
                db.run(`INSERT INTO follows (follower_id, followed_id) VALUES (?, ?)`, [miId, otro.id], (err) => {
                    if (err) return res.status(500).json({ error: 'Error en el servidor' });
                    crearNotificacion(otro.id, req.session.user.username, `${req.session.user.username} empezó a seguirte`);
                    res.json({ siguiendo: true });
                });
            }
        });
    });
});

// Perfil de "seguir": cuántos seguidores/seguidos tiene, listas, y si YO lo sigo
router.get('/users/:username/seguir-info', (req, res) => {
    const { username } = req.params;
    const miId = req.session.user ? req.session.user.id : null;

    db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, user) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        db.all(
            `SELECT users.username FROM follows JOIN users ON users.id = follows.follower_id WHERE follows.followed_id = ? ORDER BY follows.id DESC`,
            [user.id],
            (err, seguidores) => {
                if (err) return res.status(500).json({ error: 'Error en el servidor' });

                db.all(
                    `SELECT users.username FROM follows JOIN users ON users.id = follows.followed_id WHERE follows.follower_id = ? ORDER BY follows.id DESC`,
                    [user.id],
                    (err, seguidos) => {
                        if (err) return res.status(500).json({ error: 'Error en el servidor' });

                        db.get(`SELECT id FROM follows WHERE follower_id = ? AND followed_id = ?`, [miId, user.id], (err, yoLoSigo) => {
                            if (err) return res.status(500).json({ error: 'Error en el servidor' });
                            res.json({
                                seguidores: seguidores.map(r => r.username),
                                seguidos: seguidos.map(r => r.username),
                                yoLoSigo: !!yoLoSigo
                            });
                        });
                    }
                );
            }
        );
    });
});

module.exports = router;
