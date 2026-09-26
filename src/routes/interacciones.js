const express = require('express');
const db = require('../db/compat');
const requiereSesion = require('../middleware/auth');
const { crearNotificacion } = require('../services/notificaciones');

const router = express.Router();

// --- LIKES ---

router.post('/posts/:id/like', requiereSesion, (req, res) => {
    const { id } = req.params;
    const userId = req.session.user.id;

    db.get(`SELECT id FROM likes WHERE post_id = ? AND user_id = ?`, [id, userId], (err, existente) => {
        if (err) return res.status(500).json({ error: err.message });

        const terminar = (liked) => {
            db.get(`SELECT COUNT(*) AS total FROM likes WHERE post_id = ?`, [id], (err, row) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ liked, count: row.total });
            });
        };

        if (existente) {
            db.run(`DELETE FROM likes WHERE id = ?`, [existente.id], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                terminar(false);
            });
        } else {
            db.run(`INSERT INTO likes (post_id, user_id) VALUES (?, ?)`, [id, userId], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                db.get(`SELECT user_id FROM posts WHERE id = ?`, [id], (err, post) => {
                    if (post) crearNotificacion(post.user_id, req.session.user.username, `A ${req.session.user.username} le gustó tu publicación`, `post.html?id=${id}`);
                });
                terminar(true);
            });
        }
    });
});

// --- REPOSTEOS ---

router.post('/posts/:id/repost', requiereSesion, (req, res) => {
    const { id } = req.params;
    const userId = req.session.user.id;

    db.get(`SELECT id FROM reposts WHERE post_id = ? AND user_id = ?`, [id, userId], (err, existente) => {
        if (err) return res.status(500).json({ error: err.message });

        const terminar = (reposted) => {
            db.get(`SELECT COUNT(*) AS total FROM reposts WHERE post_id = ?`, [id], (err, row) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ reposted, count: row.total });
            });
        };

        if (existente) {
            db.run(`DELETE FROM reposts WHERE id = ?`, [existente.id], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                terminar(false);
            });
        } else {
            db.run(`INSERT INTO reposts (post_id, user_id) VALUES (?, ?)`, [id, userId], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                db.get(`SELECT user_id FROM posts WHERE id = ?`, [id], (err, post) => {
                    if (post) crearNotificacion(post.user_id, req.session.user.username, `${req.session.user.username} republicó tu publicación`, `post.html?id=${id}`);
                });
                terminar(true);
            });
        }
    });
});

module.exports = router;
