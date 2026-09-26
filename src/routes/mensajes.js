const express = require('express');
const db = require('../db/compat');
const requiereSesion = require('../middleware/auth');
const { crearNotificacion } = require('../services/notificaciones');
const { sonAmigos } = require('../services/amistad');

const router = express.Router();

// --- RUTAS DE MENSAJES (privados, solo entre amigos) ---

const LARGO_MAX_MENSAJE = 1000;

// Lista de conversaciones: una por cada amigo, con el último mensaje (si existe)
// y si hoy ya le mandé un mensaje a esa persona.
router.get('/messages', requiereSesion, (req, res) => {
    const miId = req.session.user.id;

    db.all(
        `SELECT users.id, users.username
         FROM friend_requests
         JOIN users ON users.id = CASE WHEN friend_requests.from_user_id = ? THEN friend_requests.to_user_id ELSE friend_requests.from_user_id END
         WHERE (friend_requests.from_user_id = ? OR friend_requests.to_user_id = ?) AND friend_requests.estado = 'aceptada'
         ORDER BY users.username ASC`,
        [miId, miId, miId],
        (err, amigos) => {
            if (err) return res.status(500).json({ error: 'Error en el servidor' });
            if (amigos.length === 0) return res.json({ conversaciones: [] });

            let pendientes = amigos.length;
            const conversaciones = [];

            amigos.forEach(amigo => {
                db.get(
                    `SELECT content, sender_id, created_at FROM messages
                     WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
                     ORDER BY id DESC LIMIT 1`,
                    [miId, amigo.id, amigo.id, miId],
                    (err, ultimo) => {
                        db.get(
                            `SELECT id FROM messages WHERE sender_id = ? AND receiver_id = ? AND created_at::date = CURRENT_DATE`,
                            [miId, amigo.id],
                            (err2, envioHoy) => {
                                conversaciones.push({
                                    username: amigo.username,
                                    ultimo_mensaje: ultimo ? ultimo.content : null,
                                    ultimo_es_mio: ultimo ? ultimo.sender_id === miId : null,
                                    ultimo_created_at: ultimo ? ultimo.created_at : null,
                                    puedo_enviar_hoy: !envioHoy
                                });
                                pendientes--;
                                if (pendientes === 0) {
                                    conversaciones.sort((a, b) => new Date(b.ultimo_created_at || 0) - new Date(a.ultimo_created_at || 0));
                                    res.json({ conversaciones });
                                }
                            }
                        );
                    }
                );
            });
        }
    );
});

// Historial de mensajes con un amigo puntual
router.get('/messages/:username', requiereSesion, (req, res) => {
    const miId = req.session.user.id;
    const { username } = req.params;

    if (username === req.session.user.username) {
        return res.status(400).json({ error: 'No puedes enviarte mensajes a ti mismo' });
    }

    db.get(`SELECT id, username FROM users WHERE username = ?`, [username], (err, otro) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!otro) return res.status(404).json({ error: 'Usuario no encontrado' });

        sonAmigos(miId, otro.id, (err, amigos) => {
            if (err) return res.status(500).json({ error: 'Error en el servidor' });
            if (!amigos) return res.status(403).json({ error: 'Solo puedes escribirle a tus amigos' });

            db.all(
                `SELECT id, sender_id, receiver_id, content, created_at FROM messages
                 WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
                 ORDER BY id ASC`,
                [miId, otro.id, otro.id, miId],
                (err, mensajes) => {
                    if (err) return res.status(500).json({ error: 'Error en el servidor' });
                    db.get(
                        `SELECT id FROM messages WHERE sender_id = ? AND receiver_id = ? AND created_at::date = CURRENT_DATE`,
                        [miId, otro.id],
                        (err2, envioHoy) => {
                            res.json({
                                mensajes: mensajes.map(m => ({ ...m, es_mio: m.sender_id === miId })),
                                puedo_enviar_hoy: !envioHoy
                            });
                        }
                    );
                }
            );
        });
    });
});

// Enviar un mensaje: solo a amigos, máx. 1000 caracteres, 1 por día por
// conversación (el límite se resetea a las 00:00 del servidor, no cada 24h
// exactas desde el último mensaje enviado).
router.post('/messages/:username', requiereSesion, (req, res) => {
    const miId = req.session.user.id;
    const { username } = req.params;
    const { content } = req.body;

    if (username === req.session.user.username) {
        return res.status(400).json({ error: 'No puedes enviarte mensajes a ti mismo' });
    }
    if (!content || !content.trim()) {
        return res.status(400).json({ error: 'El mensaje no puede estar vacío' });
    }
    if (content.trim().length > LARGO_MAX_MENSAJE) {
        return res.status(400).json({ error: `El mensaje no puede superar los ${LARGO_MAX_MENSAJE} caracteres` });
    }

    db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, otro) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!otro) return res.status(404).json({ error: 'Usuario no encontrado' });

        sonAmigos(miId, otro.id, (err, amigos) => {
            if (err) return res.status(500).json({ error: 'Error en el servidor' });
            if (!amigos) return res.status(403).json({ error: 'Solo puedes escribirle a tus amigos' });

            db.get(
                `SELECT id FROM messages WHERE sender_id = ? AND receiver_id = ? AND created_at::date = CURRENT_DATE`,
                [miId, otro.id],
                (err, envioHoy) => {
                    if (err) return res.status(500).json({ error: 'Error en el servidor' });
                    if (envioHoy) return res.status(429).json({ error: 'Ya le enviaste un mensaje hoy. Podrás volver a escribirle cuando empiece el próximo día.' });

                    db.run(
                        `INSERT INTO messages (sender_id, receiver_id, content) VALUES (?, ?, ?)`,
                        [miId, otro.id, content.trim()],
                        function(err) {
                            if (err) return res.status(500).json({ error: 'Error en el servidor' });
                            crearNotificacion(otro.id, req.session.user.username, `${req.session.user.username} te envió un mensaje`, `mensajes.html?usuario=${encodeURIComponent(req.session.user.username)}`);
                            res.status(201).json({ message: 'Mensaje enviado', mensajeId: this.lastID });
                        }
                    );
                }
            );
        });
    });
});

module.exports = router;
