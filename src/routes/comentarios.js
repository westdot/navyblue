const express = require('express');
const db = require('../db/compat');
const requiereSesion = require('../middleware/auth');
const { crearNotificacion, notificarMenciones } = require('../services/notificaciones');

const router = express.Router();

// --- COMENTARIOS (en publicaciones) ---

router.get('/posts/:id/comments', (req, res) => {
    const { id } = req.params;
    db.all(`
        SELECT comments.id, comments.user_id, comments.content, comments.created_at,
               COALESCE(users.username, 'usuario') AS username
        FROM comments
        LEFT JOIN users ON comments.user_id = users.id
        WHERE comments.post_id = ?
        ORDER BY comments.id ASC
    `, [id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ comments: rows });
    });
});

router.post('/posts/:id/comments', requiereSesion, (req, res) => {
    const { id } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
        return res.status(400).json({ error: 'El comentario no puede estar vacío' });
    }

    db.run(
        `INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)`,
        [id, req.session.user.id, content.trim()],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            db.get(`SELECT user_id FROM posts WHERE id = ?`, [id], (err, post) => {
                if (post) crearNotificacion(post.user_id, req.session.user.username, `${req.session.user.username} comentó tu publicación`, `post.html?id=${id}`);
            });
            notificarMenciones(content.trim(), req.session.user.username, 'un comentario');
            res.status(201).json({ message: 'Comentario agregado', commentId: this.lastID });
        }
    );
});

router.delete('/comments/:id', requiereSesion, (req, res) => {
    const { id } = req.params;
    const userId = req.session.user.id;

    db.get(`SELECT user_id FROM comments WHERE id = ?`, [id], (err, comment) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!comment) return res.status(404).json({ error: 'Comentario no encontrado' });
        if (comment.user_id !== userId) {
            return res.status(403).json({ error: 'No puedes eliminar comentarios de otros usuarios' });
        }
        db.run(`DELETE FROM comments WHERE id = ?`, [id], (err) => {
            if (err) return res.status(500).json({ error: 'Error al eliminar el comentario' });
            res.json({ message: 'Comentario eliminado' });
        });
    });
});

module.exports = router;
