const express = require('express');
const db = require('../db/compat');
const requiereSesion = require('../middleware/auth');
const { buscarEnOpenLibrary, buscarDetalleEnOpenLibrary } = require('../services/openLibrary');
const { notificarMenciones } = require('../services/notificaciones');

const router = express.Router();

// --- INTEGRACIÓN CON OPEN LIBRARY ---
// API pública y 100% gratuita de libros (sin API key, sin límites agresivos):
// https://openlibrary.org/developers/api
// Se usa en todo el sitio donde se necesitan datos reales de libros: la
// pestaña "Libros" del buscador, y el autocompletado al agregar libros a una
// estantería, empezar una lectura o publicar una reseña.

// Ruta que usan los formularios (estanterías, lecturas, reseñas) para
// autocompletar título/autor/portada mientras la persona escribe.
router.get('/libros/buscar', async (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ resultados: [] });
    try {
        const resultados = await buscarEnOpenLibrary(q, 8);
        res.json({ resultados });
    } catch (error) {
        console.error('Error consultando Open Library:', error.message);
        res.status(502).json({ error: 'No se pudo conectar con Open Library', resultados: [] });
    }
});

// --- PÁGINA DE DETALLE DE UN LIBRO (libro.html) ---
// Se abre al pinchar el título de un libro en cualquier parte del sitio
// (reseñas, estanterías, leyendo ahora). Junta: ficha del libro (Open
// Library, best-effort), la valoración promedio calculada con las reseñas
// que existen en NAVYBLUE, y permite comentar el libro como si fuera un post.
router.get('/libros/detalle', async (req, res) => {
    const titulo = (req.query.titulo || '').trim();
    const autor = (req.query.autor || '').trim();
    if (!titulo) return res.status(400).json({ error: 'Falta el título del libro' });

    const traerValoracion = () => new Promise((resolve) => {
        db.get(
            `SELECT AVG(valoracion) AS promedio, COUNT(*) AS total
             FROM reviews
             WHERE LOWER(libro_titulo) = LOWER(?) AND LOWER(autor) = LOWER(?)`,
            [titulo, autor],
            (err, row) => resolve(err || !row ? { promedio: null, total: 0 } : { promedio: row.promedio, total: row.total })
        );
    });

    const [valoracion, detalleExterno] = await Promise.all([
        traerValoracion(),
        buscarDetalleEnOpenLibrary(titulo, autor).catch(() => null)
    ]);

    res.json({
        titulo,
        autor,
        valoracion_promedio: valoracion.promedio !== null ? Number(valoracion.promedio) : null,
        total_opiniones: valoracion.total,
        editorial: null, idioma: null, paginas: null, categoria: null, isbn: null, anio: null, sinopsis: null,
        ...(detalleExterno || {})
    });
});

// Comentarios de la página de un libro (distintos de los comentarios de UNA
// reseña puntual: estos van ligados al libro completo, título + autor)
router.get('/libros/comments', (req, res) => {
    const titulo = (req.query.titulo || '').trim();
    const autor = (req.query.autor || '').trim();
    if (!titulo) return res.status(400).json({ error: 'Falta el título del libro' });

    db.all(
        `SELECT book_comments.id, book_comments.content, book_comments.created_at,
                COALESCE(users.username, 'usuario-eliminado') AS username
         FROM book_comments
         LEFT JOIN users ON users.id = book_comments.user_id
         WHERE LOWER(book_comments.libro_titulo) = LOWER(?) AND LOWER(book_comments.autor) = LOWER(?)
         ORDER BY book_comments.id ASC`,
        [titulo, autor],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ comments: rows });
        }
    );
});

router.post('/libros/comments', requiereSesion, (req, res) => {
    const { titulo, autor, content } = req.body;
    if (!titulo || !autor || !content || !content.trim()) {
        return res.status(400).json({ error: 'Escribe un comentario.' });
    }
    db.run(
        `INSERT INTO book_comments (libro_titulo, autor, user_id, content) VALUES (?, ?, ?, ?)`,
        [titulo, autor, req.session.user.id, content.trim()],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            notificarMenciones(content.trim(), req.session.user.username, 'un comentario en un libro');
            res.status(201).json({ message: 'Comentario publicado con éxito', id: this.lastID });
        }
    );
});

router.delete('/libros/comments/:id', requiereSesion, (req, res) => {
    const { id } = req.params;
    const userId = req.session.user.id;

    db.get(`SELECT user_id FROM book_comments WHERE id = ?`, [id], (err, comentario) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!comentario) return res.status(404).json({ error: 'Comentario no encontrado' });
        if (comentario.user_id !== userId) {
            return res.status(403).json({ error: 'No puedes eliminar comentarios de otros usuarios' });
        }
        db.run(`DELETE FROM book_comments WHERE id = ?`, [id], (err) => {
            if (err) return res.status(500).json({ error: 'Error al eliminar el comentario' });
            res.json({ message: 'Comentario eliminado con éxito' });
        });
    });
});

module.exports = router;
