const express = require('express');
const db = require('../db/compat');
const requiereSesion = require('../middleware/auth');
const { normalizarPost } = require('../utils/posts');
const { leerPaginacion, recortarPagina } = require('../utils/paginacion');
const { notificarMenciones } = require('../services/notificaciones');

const router = express.Router();

// --- RUTAS DE PUBLICACIONES (POSTS) ---

// Obtener publicaciones, de a páginas (scroll infinito): ?limit=20&before=<id>
// devuelve las `limit` más nuevas que sean anteriores al post `before`.
router.get('/posts', (req, res) => {
    const { username } = req.query;
    const { limit, before } = leerPaginacion(req.query);
    const miId = req.session.user ? req.session.user.id : null;

    const baseQuery = `
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
    `;

    // Arma el WHERE según lo que se haya pedido (usuario puntual y/o cursor)
    const traerPagina = (userIdFiltro) => {
        const condiciones = [];
        const params = [miId, miId];
        if (userIdFiltro) { condiciones.push('posts.user_id = ?'); params.push(userIdFiltro); }
        if (before) { condiciones.push('posts.id < ?'); params.push(before); }
        const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
        params.push(limit + 1);

        db.all(`${baseQuery} ${where} ORDER BY posts.id DESC LIMIT ?`, params, (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            const { filas, hasMore } = recortarPagina(rows, limit);
            res.json({ posts: filas.map(normalizarPost), hasMore });
        });
    };

    if (username) {
        // Buscamos el id de la cuenta a partir del username actual, y filtramos por ESE id
        // (así se incluyen todos sus posts, aunque algunos se hayan guardado con otro nombre)
        db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, user) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!user) return res.json({ posts: [], hasMore: false });
            traerPagina(user.id);
        });
    } else {
        traerPagina(null);
    }
});

// Obtener el detalle de UN post (para abrirlo con sus comentarios)
router.get('/posts/:id', (req, res) => {
    const { id } = req.params;
    const miId = req.session.user ? req.session.user.id : null;

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
        WHERE posts.id = ?
    `;
    db.get(query, [miId, miId, id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Publicación no encontrada' });
        res.json({ post: normalizarPost(row) });
    });
});

// Crear una nueva publicación
router.post('/posts', (req, res) => {
    // Ya NO confiamos en req.body.username: usamos quién está realmente logueado
    if (!req.session.user) {
        return res.status(401).json({ error: 'Debes iniciar sesión para publicar' });
    }

    const { id: userId, username } = req.session.user;
    const { content, tag } = req.body;

    if (!content) {
        return res.status(400).json({ error: 'Faltan datos obligatorios para publicar' });
    }

    const query = `INSERT INTO posts (user_id, username, content, tag) VALUES (?, ?, ?, ?)`;
    db.run(query, [userId, username, content, tag || 'General'], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        notificarMenciones(content, username, 'una publicación');
        res.status(201).json({ 
            message: 'Publicación creada con éxito', 
            postId: this.lastID 
        });
    });
});

// Eliminar una publicación: solo el dueño de la cuenta que la creó puede borrarla
router.delete('/posts/:id', requiereSesion, (req, res) => {
    const { id } = req.params;
    const userId = req.session.user.id;

    db.get(`SELECT user_id FROM posts WHERE id = ?`, [id], (err, post) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!post) return res.status(404).json({ error: 'Publicación no encontrada' });
        if (post.user_id !== userId) {
            return res.status(403).json({ error: 'No puedes eliminar publicaciones de otros usuarios' });
        }

        db.run(`DELETE FROM posts WHERE id = ?`, [id], (err) => {
            if (err) return res.status(500).json({ error: 'Error al eliminar la publicación' });
            // Limpiamos también lo que dependía de este post, para no dejar basura suelta
            db.run(`DELETE FROM comments WHERE post_id = ?`, [id]);
            db.run(`DELETE FROM likes WHERE post_id = ?`, [id]);
            db.run(`DELETE FROM reposts WHERE post_id = ?`, [id]);
            res.json({ message: 'Publicación eliminada con éxito' });
        });
    });
});

module.exports = router;
