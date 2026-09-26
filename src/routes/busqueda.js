const express = require('express');
const db = require('../db/compat');
const { buscarEnOpenLibrary } = require('../services/openLibrary');

const router = express.Router();

// --- RUTA DE BÚSQUEDA ---

router.get('/search', (req, res) => {
    const tipo = (req.query.tipo || '').toLowerCase();
    const q = (req.query.q || '').trim();

    if (!q) {
        return res.json({ implementado: true, resultados: [] });
    }

    if (tipo === 'usuarios') {
        db.all(
            `SELECT username, name FROM users WHERE username ILIKE ? OR name ILIKE ? LIMIT 10`,
            [`%${q}%`, `%${q}%`],
            (err, rows) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({
                    implementado: true,
                    resultados: rows.map(r => ({ titulo: r.username, subtitulo: r.name }))
                });
            }
        );
    } else if (tipo === 'libros') {
        buscarEnOpenLibrary(q, 10)
            .then(resultados => {
                res.json({
                    implementado: true,
                    resultados: resultados.map(r => ({
                        titulo: r.titulo,
                        autor: r.autor,
                        subtitulo: r.anio ? `${r.autor} · ${r.anio}` : r.autor,
                        portada_url: r.portada_url
                    }))
                });
            })
            .catch((error) => {
                console.error('Error buscando libros en Open Library:', error.message);
                res.json({ implementado: true, resultados: [] });
            });
    } else {
        // editoriales, mangas, novelas-ligeras: todavía no tienen tabla propia
        res.json({ implementado: false, resultados: [] });
    }
});

module.exports = router;
