const express = require('express');
const db = require('../db/compat');
const requiereSesion = require('../middleware/auth');
const { crearNotificacion } = require('../services/notificaciones');

const router = express.Router();

// --- RUTAS DE AMIGOS (simétrico, con solicitud + aceptación — separado de seguir) ---

// Enviar solicitud de amistad
router.post('/friends/:username/solicitar', requiereSesion, (req, res) => {
    const miId = req.session.user.id;
    const { username } = req.params;

    if (username === req.session.user.username) {
        return res.status(400).json({ error: 'No puedes agregarte a ti mismo' });
    }

    db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, otro) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!otro) return res.status(404).json({ error: 'Usuario no encontrado' });

        // Si el otro ya te había mandado una solicitud a ti, la aceptamos directo (como Facebook)
        db.get(
            `SELECT id, estado FROM friend_requests WHERE from_user_id = ? AND to_user_id = ?`,
            [otro.id, miId],
            (err, inversa) => {
                if (err) return res.status(500).json({ error: 'Error en el servidor' });

                if (inversa) {
                    db.run(`UPDATE friend_requests SET estado = 'aceptada' WHERE id = ?`, [inversa.id], (err) => {
                        if (err) return res.status(500).json({ error: 'Error en el servidor' });
                        crearNotificacion(otro.id, req.session.user.username, `Tú y ${req.session.user.username} ahora son amigos`);
                        res.json({ estado: 'amigos' });
                    });
                    return;
                }

                db.run(
                    `INSERT INTO friend_requests (from_user_id, to_user_id, estado) VALUES (?, ?, 'pendiente')`,
                    [miId, otro.id],
                    (err) => {
                        if (err) return res.status(400).json({ error: 'Ya existe una solicitud con este usuario' });
                        crearNotificacion(otro.id, req.session.user.username, `${req.session.user.username} te envió una solicitud de amistad`);
                        res.json({ estado: 'solicitud_enviada' });
                    }
                );
            }
        );
    });
});

// Aceptar una solicitud que ME mandaron
router.post('/friends/:username/aceptar', requiereSesion, (req, res) => {
    const miId = req.session.user.id;
    const { username } = req.params;

    db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, otro) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!otro) return res.status(404).json({ error: 'Usuario no encontrado' });

        db.run(
            `UPDATE friend_requests SET estado = 'aceptada' WHERE from_user_id = ? AND to_user_id = ? AND estado = 'pendiente'`,
            [otro.id, miId],
            function(err) {
                if (err) return res.status(500).json({ error: 'Error en el servidor' });
                if (this.changes === 0) return res.status(404).json({ error: 'No hay ninguna solicitud pendiente de esa persona' });
                crearNotificacion(otro.id, req.session.user.username, `${req.session.user.username} aceptó tu solicitud de amistad`);
                res.json({ estado: 'amigos' });
            }
        );
    });
});

// Rechazar una solicitud recibida, cancelar una que enviaste, o eliminar una amistad ya existente
router.delete('/friends/:username', requiereSesion, (req, res) => {
    const miId = req.session.user.id;
    const { username } = req.params;

    db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, otro) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!otro) return res.status(404).json({ error: 'Usuario no encontrado' });

        db.run(
            `DELETE FROM friend_requests WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)`,
            [miId, otro.id, otro.id, miId],
            (err) => {
                if (err) return res.status(500).json({ error: 'Error en el servidor' });
                res.json({ estado: 'ninguno' });
            }
        );
    });
});

// Estado de amistad entre TÚ y un usuario, además de su lista de amigos
router.get('/users/:username/amigos-info', (req, res) => {
    const { username } = req.params;
    const miId = req.session.user ? req.session.user.id : null;

    db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, user) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        db.all(
            `SELECT users.username
             FROM friend_requests
             JOIN users ON users.id = CASE WHEN friend_requests.from_user_id = ? THEN friend_requests.to_user_id ELSE friend_requests.from_user_id END
             WHERE (friend_requests.from_user_id = ? OR friend_requests.to_user_id = ?) AND friend_requests.estado = 'aceptada'`,
            [user.id, user.id, user.id],
            (err, amigos) => {
                if (err) return res.status(500).json({ error: 'Error en el servidor' });

                if (!miId || miId === user.id) {
                    return res.json({ amigos: amigos.map(r => r.username), estado: miId ? 'yo_mismo' : 'sin_sesion' });
                }

                db.get(
                    `SELECT estado, from_user_id FROM friend_requests WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)`,
                    [miId, user.id, user.id, miId],
                    (err, relacion) => {
                        if (err) return res.status(500).json({ error: 'Error en el servidor' });

                        let estado = 'ninguno';
                        if (relacion) {
                            if (relacion.estado === 'aceptada') estado = 'amigos';
                            else estado = relacion.from_user_id === miId ? 'solicitud_enviada' : 'solicitud_recibida';
                        }

                        res.json({ amigos: amigos.map(r => r.username), estado });
                    }
                );
            }
        );
    });
});

module.exports = router;
