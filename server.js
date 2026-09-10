const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para parsear JSON y servir archivos estáticos
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // Asume que tus archivos HTML/CSS están en una carpeta 'public'

// Conexión y configuración de la base de datos SQLite
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) {
        console.error('Error al conectar con la base de datos:', err.message);
    } else {
        console.log('Conectado a la base de datos SQLite.');
    }
});

// Crear tablas si no existen
db.serialize(() => {
    // Tabla de usuarios
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
    )`);

    // Tabla de libros
    db.run(`CREATE TABLE IF NOT EXISTS books (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        author TEXT NOT NULL,
        price REAL NOT NULL,
        stock INTEGER NOT NULL
    )`);
});

// --- RUTAS DE AUTENTICACIÓN ---

// Registro de usuario
app.post('/api/register', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Faltan datos obligatorios' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const query = `INSERT INTO users (email, password) VALUES (?, ?)`;
        
        db.run(query, [email, hashedPassword], function(err) {
            if (err) {
                return res.status(400).json({ error: 'El correo ya está registrado' });
            }
            res.status(201).json({ message: 'Usuario registrado con éxito', userId: this.lastID });
        });
    } catch (error) {
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Inicio de sesión
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    
    db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!user) return res.status(400).json({ error: 'Credenciales inválidas' });

        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(400).json({ error: 'Credenciales inválidas' });

        res.json({ message: 'Inicio de sesión exitoso', email: user.email });
    });
});

// --- RUTAS DE LIBROS ---

// Obtener todos los libros
app.get('/api/books', (req, res) => {
    db.all(`SELECT * FROM books`, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ books: rows });
    });
});

// Agregar un libro nuevo (útil para administración o pruebas)
app.post('/api/books', (req, res) => {
    const { title, author, price, stock } = req.body;
    const query = `INSERT INTO books (title, author, price, stock) VALUES (?, ?, ?, ?)`;

    db.run(query, [title, author, price, stock], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.status(201).json({ message: 'Libro agregado', bookId: this.lastID });
    });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});