const express = require('express');
const db = require('../db/compat');
const { normalizarPost } = require('../utils/posts');

const router = express.Router();

// --- TRENDING (temas del momento, extraídos de los hashtags de los posts) ---

router.get('/trending', (req, res) => {
    db.all(
        `SELECT MIN(tag) AS tag, COUNT(*) AS cantidad
         FROM posts
         WHERE tag IS NOT NULL AND TRIM(tag) != ''
         GROUP BY LOWER(tag)
         ORDER BY cantidad DESC
         LIMIT 8`,
        [],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ trending: rows });
        }
    );
});

// Posts de un tema del trending, con opción de ordenarlos por likes,
// comentarios o fecha (cada uno ascendente o descendente). Usado por la
// página propia de un trending (tendencia.html).
const ORDEN_TRENDING_PERMITIDO = {
    likes: 'likes_count',
    comentarios: 'comments_count',
    fecha: 'posts.created_at'
};

router.get('/trending/:tag/posts', (req, res) => {
    const { tag } = req.params;
    const miId = req.session.user ? req.session.user.id : null;
    const columnaOrden = ORDEN_TRENDING_PERMITIDO[req.query.orden] || 'posts.created_at';
    const direccion = req.query.dir === 'asc' ? 'ASC' : 'DESC';

    const query = `
        SELECT
            posts.id,
            posts.user_id,
            posts.content,
            posts.tag,
            posts.created_at,
            COALESCE(users.username, posts.username) AS username,
            (SELECT COUNT(*) FROM comments WHERE comments.post_id = posts.id) AS comments_count,
            (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id) AS likes_count,
            (SELECT COUNT(*) FROM reposts WHERE reposts.post_id = posts.id) AS reposts_count,
            (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id AND likes.user_id = ?) AS liked_by_me,
            (SELECT COUNT(*) FROM reposts WHERE reposts.post_id = posts.id AND reposts.user_id = ?) AS reposted_by_me
        FROM posts
        LEFT JOIN users ON posts.user_id = users.id
        WHERE LOWER(posts.tag) = LOWER(?)
        ORDER BY ${columnaOrden} ${direccion}, posts.id DESC
    `;

    db.all(query, [miId, miId, tag], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ posts: rows.map(normalizarPost) });
    });
});

module.exports = router;
