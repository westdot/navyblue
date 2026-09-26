const express = require('express');
const db = require('../db/compat');
const requiereSesion = require('../middleware/auth');
const { crearNotificacion } = require('../services/notificaciones');

const router = express.Router();

// --- RUTAS DE PREGUNTAS (públicas, 1 por día de cada usuario hacia cada otro) ---

const LARGO_MAX_PREGUNTA = 200;

// Feed general de preguntas (todas), o las hechas a un usuario puntual (?username=)
router.get('/questions', (req, res) => {
    const { username } = req.query;

    if (username) {
        db.all(
            `SELECT id, asker_username, asked_username, content, respuesta, created_at
             FROM questions WHERE asked_username = ? ORDER BY id DESC`,
            [username],
            (err, rows) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ questions: rows });
            }
        );
    } else {
        db.all(
            `SELECT id, asker_username, asked_username, content, respuesta, created_at FROM questions ORDER BY id DESC`,
            [],
            (err, rows) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ questions: rows });
            }
        );
    }
});

// Si hoy ya le hice una pregunta a esta persona (para deshabilitar el botón en el frontend)
router.get('/questions/:username/estado', requiereSesion, (req, res) => {
    const miId = req.session.user.id;
    const { username } = req.params;

    db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, otro) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!otro) return res.status(404).json({ error: 'Usuario no encontrado' });

        db.get(
            `SELECT id FROM questions WHERE asker_id = ? AND asked_id = ? AND created_at::date = CURRENT_DATE`,
            [miId, otro.id],
            (err, preguntaHoy) => {
                if (err) return res.status(500).json({ error: 'Error en el servidor' });
                res.json({ yaPreguntoHoy: !!preguntaHoy });
            }
        );
    });
});

// Hacer una pregunta pública a alguien: máx. 200 caracteres, 1 por día por persona
router.post('/questions/:username', requiereSesion, (req, res) => {
    const miId = req.session.user.id;
    const miUsername = req.session.user.username;
    const { username } = req.params;
    const { content } = req.body;

    if (username === miUsername) {
        return res.status(400).json({ error: 'No puedes hacerte una pregunta a ti mismo' });
    }
    if (!content || !content.trim()) {
        return res.status(400).json({ error: 'La pregunta no puede estar vacía' });
    }
    if (content.trim().length > LARGO_MAX_PREGUNTA) {
        return res.status(400).json({ error: `La pregunta no puede superar los ${LARGO_MAX_PREGUNTA} caracteres` });
    }

    db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, otro) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!otro) return res.status(404).json({ error: 'Usuario no encontrado' });

        db.get(
            `SELECT id FROM questions WHERE asker_id = ? AND asked_id = ? AND created_at::date = CURRENT_DATE`,
            [miId, otro.id],
            (err, preguntaHoy) => {
                if (err) return res.status(500).json({ error: 'Error en el servidor' });
                if (preguntaHoy) return res.status(429).json({ error: 'Ya le hiciste una pregunta hoy a esta persona. Podrás preguntarle de nuevo mañana.' });

                db.run(
                    `INSERT INTO questions (asker_id, asker_username, asked_id, asked_username, content) VALUES (?, ?, ?, ?, ?)`,
                    [miId, miUsername, otro.id, username, content.trim()],
                    function(err) {
                        if (err) return res.status(500).json({ error: 'Error en el servidor' });
                        crearNotificacion(otro.id, miUsername, `${miUsername} te hizo una pregunta`);
                        res.status(201).json({ message: 'Pregunta enviada', questionId: this.lastID });
                    }
                );
            }
        );
    });
});

// Responder una pregunta que te hicieron: solo puede hacerlo asked_id (el
// dueño del muro donde cayó la pregunta), y solo si todavía no tiene
// respuesta (una sola respuesta por pregunta, no se puede editar después).
router.put('/questions/:id/responder', requiereSesion, (req, res) => {
    const { id } = req.params;
    const { respuesta } = req.body;
    const miId = req.session.user.id;
    const miUsername = req.session.user.username;

    if (!respuesta || !respuesta.trim()) {
        return res.status(400).json({ error: 'La respuesta no puede estar vacía' });
    }
    if (respuesta.trim().length > LARGO_MAX_PREGUNTA) {
        return res.status(400).json({ error: `La respuesta no puede superar los ${LARGO_MAX_PREGUNTA} caracteres` });
    }

    db.get(`SELECT * FROM questions WHERE id = ?`, [id], (err, pregunta) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!pregunta) return res.status(404).json({ error: 'Pregunta no encontrada' });
        if (pregunta.asked_id !== miId) {
            return res.status(403).json({ error: 'Solo la persona a la que le hicieron la pregunta puede responderla' });
        }
        if (pregunta.respuesta) {
            return res.status(400).json({ error: 'Esta pregunta ya tiene una respuesta' });
        }

        db.run(
            `UPDATE questions SET respuesta = ?, respondida_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [respuesta.trim(), id],
            (err) => {
                if (err) return res.status(500).json({ error: 'Error en el servidor' });
                crearNotificacion(pregunta.asker_id, miUsername, `${miUsername} respondió tu pregunta`, `muro.html?usuario=${encodeURIComponent(miUsername)}`);
                res.json({ message: 'Respuesta publicada', respuesta: respuesta.trim() });
            }
        );
    });
});

module.exports = router;
