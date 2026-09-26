const express = require('express');
const db = require('../db/compat');

const router = express.Router();

// --- RUTAS DE LIBROS (tabla "books": catálogo simple con precio/stock,
// distinto de la integración con Open Library en routes/libros.js) ---

// Obtener todos los libros
router.get('/books', (req, res) => {
    db.all(`SELECT * FROM books`, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ books: rows });
    });
});

// Agregar un libro nuevo (útil para administración o pruebas)
router.post('/books', (req, res) => {
    const { title, author, price, stock } = req.body;
    const query = `INSERT INTO books (title, author, price, stock) VALUES (?, ?, ?, ?)`;

    db.run(query, [title, author, price, stock], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.status(201).json({ message: 'Libro agregado', bookId: this.lastID });
    });
});

module.exports = router;
