const express = require('express');
const db = require('../db/compat');
const requiereSesion = require('../middleware/auth');
const { crearNotificacion, notificarMenciones } = require('../services/notificaciones');
const { leerPaginacion, recortarPagina } = require('../utils/paginacion');

const router = express.Router();

// --- RUTAS DE RESEÑAS (funcionalidad separada de los posts) ---

// Listar reseñas recientes, de a páginas (scroll infinito): ?limit=20&before=<id>.
// Incluye sus contadores y tu propia reacción si tienes sesión.
router.get('/reviews', (req, res) => {
    const miId = req.session.user ? req.session.user.id : null;
    const { username } = req.query;
    const { limit, before } = leerPaginacion(req.query);

    const baseQuery = `
        SELECT
            reviews.id, reviews.user_id, reviews.libro_titulo, reviews.autor,
            reviews.portada_url, reviews.valoracion, reviews.texto, reviews.created_at,
            COALESCE(users.username, reviews.username) AS username,
            (SELECT COUNT(*) FROM review_reactions WHERE review_id = reviews.id AND tipo = 'like') AS likes_count,
            (SELECT COUNT(*) FROM review_reactions WHERE review_id = reviews.id AND tipo = 'dislike') AS dislikes_count,
            (SELECT tipo FROM review_reactions WHERE review_id = reviews.id AND user_id = ?) AS mi_reaccion
        FROM reviews
        LEFT JOIN users ON reviews.user_id = users.id
    `;

    const traerPagina = (userIdFiltro) => {
        const condiciones = [];
        const params = [miId];
        if (userIdFiltro) { condiciones.push('reviews.user_id = ?'); params.push(userIdFiltro); }
        if (before) { condiciones.push('reviews.id < ?'); params.push(before); }
        const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
        params.push(limit + 1);

        db.all(`${baseQuery} ${where} ORDER BY reviews.id DESC LIMIT ?`, params, (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            const { filas, hasMore } = recortarPagina(rows, limit);
            res.json({ reviews: filas, hasMore });
        });
    };

    if (username) {
        db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, user) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!user) return res.json({ reviews: [], hasMore: false });
            traerPagina(user.id);
        });
    } else {
        traerPagina(null);
    }
});

// "Reseñas Recientes" de la barra lateral: en vez de listar reseñas sueltas
// (donde un mismo libro con 2 reseñas aparecería 2 veces), agrupamos por
// libro (título + autor, sin importar mayúsculas) y mostramos el TOP 3. El
// orden se basa en cuántas reseñas recibió cada libro en los ÚLTIMOS 3 DÍAS
// (no el total histórico), así la lista va mutando día a día según lo que
// esté reseñándose ahora; como desempate (si hay poca actividad reciente)
// usamos el total histórico y luego la reseña más nueva. De cada libro se
// muestra como representante su reseña más reciente (con la valoración de
// quien la escribió), junto con el promedio de valoración de TODAS sus
// reseñas y el total de reseñas que tiene.
router.get('/reviews/top', (req, res) => {
    const miId = req.session.user ? req.session.user.id : null;

    const query = `
        SELECT
            reviews.id, reviews.user_id, reviews.libro_titulo, reviews.autor,
            reviews.portada_url, reviews.valoracion, reviews.texto, reviews.created_at,
            COALESCE(users.username, reviews.username) AS username,
            (SELECT COUNT(*) FROM review_reactions WHERE review_id = reviews.id AND tipo = 'like') AS likes_count,
            (SELECT COUNT(*) FROM review_reactions WHERE review_id = reviews.id AND tipo = 'dislike') AS dislikes_count,
            (SELECT tipo FROM review_reactions WHERE review_id = reviews.id AND user_id = ?) AS mi_reaccion,
            conteo.total_resenas,
            conteo.promedio_valoracion
        FROM reviews
        LEFT JOIN users ON reviews.user_id = users.id
        JOIN (
            SELECT LOWER(libro_titulo) AS libro_key, LOWER(autor) AS autor_key,
                   COUNT(*) AS total_resenas,
                   ROUND(AVG(valoracion)::numeric, 1) AS promedio_valoracion,
                   MAX(id) AS id_representativo,
                   COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '3 days') AS recientes_3dias
            FROM reviews
            GROUP BY LOWER(libro_titulo), LOWER(autor)
        ) AS conteo
            ON LOWER(reviews.libro_titulo) = conteo.libro_key
            AND LOWER(reviews.autor) = conteo.autor_key
            AND reviews.id = conteo.id_representativo
        ORDER BY conteo.recientes_3dias DESC, conteo.total_resenas DESC, reviews.id DESC
        LIMIT 3
    `;

    db.all(query, [miId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ reviews: rows });
    });
});

// Obtener el detalle de UNA reseña (para abrirla en su propia página cuando
// el texto no alcanza en el espacio reducido de la tarjeta)
router.get('/reviews/:id', (req, res) => {
    const { id } = req.params;
    const miId = req.session.user ? req.session.user.id : null;

    const query = `
        SELECT
            reviews.id, reviews.user_id, reviews.libro_titulo, reviews.autor,
            reviews.portada_url, reviews.valoracion, reviews.texto, reviews.created_at,
            COALESCE(users.username, reviews.username) AS username,
            (SELECT COUNT(*) FROM review_reactions WHERE review_id = reviews.id AND tipo = 'like') AS likes_count,
            (SELECT COUNT(*) FROM review_reactions WHERE review_id = reviews.id AND tipo = 'dislike') AS dislikes_count,
            (SELECT tipo FROM review_reactions WHERE review_id = reviews.id AND user_id = ?) AS mi_reaccion
        FROM reviews
        LEFT JOIN users ON reviews.user_id = users.id
        WHERE reviews.id = ?
    `;
    db.get(query, [miId, id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Reseña no encontrada' });
        res.json({ review: row });
    });
});

// Crear una reseña: título, autor, portada (opcional), valoración 1-5 y un texto
// de opinión opcional. Además, la reseña reciente se agrega automáticamente a
// la estantería "Terminado" (se crea si el usuario todavía no la tiene, y no se
// duplica si el libro ya estaba ahí).
router.post('/reviews', requiereSesion, (req, res) => {
    const { id: userId, username } = req.session.user;
    const { libro_titulo, autor, portada_url, valoracion, texto } = req.body;
    const val = parseFloat(valoracion);
    // La valoración admite medias estrellas: 0.5, 1, 1.5, 2 ... 5
    const esValoracionValida = !isNaN(val) && val >= 0.5 && val <= 5 && Math.round(val * 2) === val * 2;

    if (!libro_titulo || !autor || !esValoracionValida) {
        return res.status(400).json({ error: 'Completa título, autor y una valoración entre 0,5 y 5 (se permiten medias estrellas).' });
    }

    // Agrega el libro reseñado a la estantería "Terminado" del usuario, creándola
    // si todavía no existe, y sin duplicarlo si ya estaba ahí.
    function agregarALeidos(callback) {
        db.get(`SELECT id FROM shelves WHERE user_id = ? AND LOWER(nombre) = LOWER(?)`, [userId, 'Terminado'], (err, estante) => {
            if (err) return callback();

            const insertarSiFalta = (shelfId) => {
                db.get(
                    `SELECT id FROM shelf_items WHERE shelf_id = ? AND LOWER(libro_titulo) = LOWER(?) AND LOWER(autor) = LOWER(?)`,
                    [shelfId, libro_titulo, autor],
                    (err, existente) => {
                        if (err || existente) return callback();
                        db.run(
                            `INSERT INTO shelf_items (shelf_id, libro_titulo, autor, portada_url) VALUES (?, ?, ?, ?)`,
                            [shelfId, libro_titulo, autor, portada_url || null],
                            () => callback()
                        );
                    }
                );
            };

            if (estante) {
                insertarSiFalta(estante.id);
            } else {
                db.run(`INSERT INTO shelves (user_id, nombre) VALUES (?, ?)`, [userId, 'Terminado'], function(err) {
                    if (err) return callback();
                    insertarSiFalta(this.lastID);
                });
            }
        });
    }

    db.run(
        `INSERT INTO reviews (user_id, username, libro_titulo, autor, portada_url, valoracion, texto) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId, username, libro_titulo, autor, portada_url || null, val, (texto || '').trim() || null],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            const reviewId = this.lastID;
            if (texto && texto.trim()) notificarMenciones(texto.trim(), username, 'una reseña');
            agregarALeidos(() => {
                res.status(201).json({ message: 'Reseña publicada con éxito', reviewId });
            });
        }
    );
});

// Eliminar una reseña propia
router.delete('/reviews/:id', requiereSesion, (req, res) => {
    const { id } = req.params;
    const userId = req.session.user.id;

    db.get(`SELECT user_id FROM reviews WHERE id = ?`, [id], (err, review) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!review) return res.status(404).json({ error: 'Reseña no encontrada' });
        if (review.user_id !== userId) {
            return res.status(403).json({ error: 'No puedes eliminar reseñas de otros usuarios' });
        }
        db.run(`DELETE FROM reviews WHERE id = ?`, [id], (err) => {
            if (err) return res.status(500).json({ error: 'Error al eliminar la reseña' });
            db.run(`DELETE FROM review_reactions WHERE review_id = ?`, [id]);
            db.run(`DELETE FROM review_comments WHERE review_id = ?`, [id]);
            res.json({ message: 'Reseña eliminada con éxito' });
        });
    });
});

// --- COMENTARIOS EN RESEÑAS ---

router.get('/reviews/:id/comments', (req, res) => {
    const { id } = req.params;
    db.all(`
        SELECT review_comments.id, review_comments.user_id, review_comments.content, review_comments.created_at,
               COALESCE(users.username, 'usuario') AS username
        FROM review_comments
        LEFT JOIN users ON review_comments.user_id = users.id
        WHERE review_comments.review_id = ?
        ORDER BY review_comments.id ASC
    `, [id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ comments: rows });
    });
});

router.post('/reviews/:id/comments', requiereSesion, (req, res) => {
    const { id } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
        return res.status(400).json({ error: 'El comentario no puede estar vacío' });
    }

    db.run(
        `INSERT INTO review_comments (review_id, user_id, content) VALUES (?, ?, ?)`,
        [id, req.session.user.id, content.trim()],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            db.get(`SELECT user_id FROM reviews WHERE id = ?`, [id], (err, review) => {
                if (review) crearNotificacion(review.user_id, req.session.user.username, `${req.session.user.username} comentó tu reseña`, `resena.html?id=${id}`);
            });
            notificarMenciones(content.trim(), req.session.user.username, 'un comentario de reseña');
            res.status(201).json({ message: 'Comentario agregado', commentId: this.lastID });
        }
    );
});

router.delete('/review-comments/:id', requiereSesion, (req, res) => {
    const { id } = req.params;
    const userId = req.session.user.id;

    db.get(`SELECT user_id FROM review_comments WHERE id = ?`, [id], (err, comment) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!comment) return res.status(404).json({ error: 'Comentario no encontrado' });
        if (comment.user_id !== userId) {
            return res.status(403).json({ error: 'No puedes eliminar comentarios de otros usuarios' });
        }
        db.run(`DELETE FROM review_comments WHERE id = ?`, [id], (err) => {
            if (err) return res.status(500).json({ error: 'Error al eliminar el comentario' });
            res.json({ message: 'Comentario eliminado' });
        });
    });
});

// Dar/quitar/cambiar like o dislike a una reseña (una sola reacción por persona)
router.post('/reviews/:id/reaccionar', requiereSesion, (req, res) => {
    const { id } = req.params;
    const userId = req.session.user.id;
    const { tipo } = req.body; // 'like' | 'dislike'

    if (tipo !== 'like' && tipo !== 'dislike') {
        return res.status(400).json({ error: 'Tipo de reacción inválido' });
    }

    const responderConContadores = () => {
        db.get(
            `SELECT
                (SELECT COUNT(*) FROM review_reactions WHERE review_id = ? AND tipo = 'like') AS likes_count,
                (SELECT COUNT(*) FROM review_reactions WHERE review_id = ? AND tipo = 'dislike') AS dislikes_count,
                (SELECT tipo FROM review_reactions WHERE review_id = ? AND user_id = ?) AS mi_reaccion
            `,
            [id, id, id, userId],
            (err, row) => {
                if (err) return res.status(500).json({ error: 'Error en el servidor' });
                res.json(row);
            }
        );
    };

    db.get(`SELECT id, tipo FROM review_reactions WHERE review_id = ? AND user_id = ?`, [id, userId], (err, existente) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });

        if (existente && existente.tipo === tipo) {
            // Ya tenías esta misma reacción -> se quita (toggle)
            db.run(`DELETE FROM review_reactions WHERE id = ?`, [existente.id], (err) => {
                if (err) return res.status(500).json({ error: 'Error en el servidor' });
                responderConContadores();
            });
        } else if (existente) {
            // Tenías la contraria -> se reemplaza
            db.run(`UPDATE review_reactions SET tipo = ? WHERE id = ?`, [tipo, existente.id], (err) => {
                if (err) return res.status(500).json({ error: 'Error en el servidor' });
                responderConContadores();
            });
        } else {
            db.run(`INSERT INTO review_reactions (review_id, user_id, tipo) VALUES (?, ?, ?)`, [id, userId, tipo], (err) => {
                if (err) return res.status(500).json({ error: 'Error en el servidor' });
                db.get(`SELECT user_id FROM reviews WHERE id = ?`, [id], (err, review) => {
                    if (review) {
                        const verbo = tipo === 'like' ? 'le gustó' : 'no le gustó';
                        crearNotificacion(review.user_id, req.session.user.username, `A ${req.session.user.username} ${verbo} tu reseña`, `resena.html?id=${id}`);
                    }
                });
                responderConContadores();
            });
        }
    });
});

module.exports = router;
