const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para parsear JSON y servir archivos estáticos
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // Asume que los archivos HTML/CSS están en una carpeta 'public'

// Middleware de sesión: el servidor recuerda quién inició sesión mediante una cookie firmada
app.use(session({
    secret: 'cambia-esto-por-una-frase-larga-y-secreta', // TODO: mover a una variable de entorno
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24, // la sesión dura 24 horas
        httpOnly: true
        // secure: true  // descomenta esto cuando sirvas el sitio con HTTPS
    }
}));

// Conexión y configuración de la base de datos SQLite
const dbPath = path.join(__dirname, 'database.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error al conectar con la base de datos:', err.message);
    } else {
        console.log('Conectado a la base de datos SQLite.');
    }
});

// Crear tablas, si no existen
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        pais TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Migracion: si la tabla ya existia de antes (sin estas columnas), las agregamos.
    // Si ya existen, SQLite devuelve error "duplicate column" y simplemente lo ignoramos.
    db.run(`ALTER TABLE users ADD COLUMN pais TEXT`, (err) => {
        console.log('[DEBUG] ALTER pais:', err ? err.message : 'OK, columna agregada');
    });
    // OJO: no se le puede poner "DEFAULT CURRENT_TIMESTAMP" a una columna agregada
    // con ALTER TABLE si la tabla ya tiene filas (SQLite lo prohibe). Por eso se
    // agrega sin default, y las filas existentes se rellenan aparte con UPDATE.
    db.run(`ALTER TABLE users ADD COLUMN created_at DATETIME`, (err) => {
        console.log('[DEBUG] ALTER created_at:', err ? err.message : 'OK, columna agregada');
    });
    db.run(`UPDATE users SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL`, (err) => {
        console.log('[DEBUG] Backfill created_at:', err ? err.message : 'OK');
    });

    db.run(`CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        content TEXT NOT NULL,
        tag TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

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
    const { name, username, email, password, pais } = req.body;
    
    if (!name || !username || !email || !password) {
        return res.status(400).json({ error: 'Faltan datos obligatorios' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const query = `INSERT INTO users (name, username, email, password, pais, created_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`;
        
        db.run(query, [name, username, email, hashedPassword, pais || null], function(err) {
            if (err) {
                // Si hay error, puede ser que el email o el username ya existan
                return res.status(400).json({ error: 'El correo o el nombre de usuario ya están en uso' });
            }
            res.status(201).json({ message: 'Usuario registrado con éxito', userId: this.lastID });
        });
    } catch (error) {
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// --- RUTAS DE PUBLICACIONES (POSTS) ---

// Obtener todas las publicaciones
app.get('/api/posts', (req, res) => {
    const { username } = req.query;
    if (username) {
        db.all(`SELECT * FROM posts WHERE username = ? ORDER BY id DESC`, [username], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ posts: rows });
        });
    } else {
        db.all(`SELECT * FROM posts ORDER BY id DESC`, [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ posts: rows });
        });
    }
});

// Crear una nueva publicación
app.post('/api/posts', (req, res) => {
    // Ya NO confiamos en req.body.username: usamos quién está realmente logueado
    if (!req.session.user) {
        return res.status(401).json({ error: 'Debes iniciar sesión para publicar' });
    }

    const username = req.session.user.username;
    const { content, tag } = req.body;

    if (!content) {
        return res.status(400).json({ error: 'Faltan datos obligatorios para publicar' });
    }

    const query = `INSERT INTO posts (username, content, tag) VALUES (?, ?, ?)`;
    db.run(query, [username, content, tag || 'General'], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.status(201).json({ 
            message: 'Publicación creada con éxito', 
            postId: this.lastID 
        });
    });
});

// Inicio de sesión actualizado
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    
    db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!user) return res.status(400).json({ error: 'Credenciales inválidas' });

        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(400).json({ error: 'Credenciales inválidas' });

        // Guardamos al usuario en la SESIÓN del servidor (no en algo que controle el cliente)
        req.session.user = {
            name: user.name,
            username: user.username,
            email: user.email
        };

        // Devolvemos también el nombre y el username (sin la contraseña)
        res.json({ 
            message: 'Inicio de sesión exitoso', 
            name: user.name,
            username: user.username,
            email: user.email 
        });
    });
});

// Saber si hay una sesión activa (para que el frontend pregunte al servidor, no a localStorage)
app.get('/api/session', (req, res) => {
    if (req.session.user) {
        res.json({ loggedIn: true, user: req.session.user });
    } else {
        res.json({ loggedIn: false });
    }
});

// Cerrar sesión
app.post('/api/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ message: 'Sesión cerrada' });
    });
});

// --- RUTAS DE PERFIL ---

// Middleware simple: exige que haya sesión activa
function requiereSesion(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Debes iniciar sesión' });
    }
    next();
}

// Obtener los datos del perfil propio
app.get('/api/profile', requiereSesion, (req, res) => {
    const { username } = req.session.user;
    db.get(`SELECT id, name, username, email, pais, created_at FROM users WHERE username = ?`, [username], (err, user) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
        res.json({ user });
    });
});

// Actualizar nombre / usuario / correo
app.put('/api/profile', requiereSesion, (req, res) => {
    const currentUsername = req.session.user.username;
    const { name, username, email, pais } = req.body;

    if (!name || !username || !email) {
        return res.status(400).json({ error: 'Faltan datos obligatorios' });
    }

    const query = `UPDATE users SET name = ?, username = ?, email = ?, pais = ? WHERE username = ?`;
    db.run(query, [name, username, email, pais || null, currentUsername], function(err) {
        if (err) {
            return res.status(400).json({ error: 'El correo o el nombre de usuario ya están en uso' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        // Actualizamos también la sesión, ya que el username pudo haber cambiado
        req.session.user = { name, username, email };
        res.json({ message: 'Perfil actualizado con éxito', user: req.session.user });
    });
});

// Cambiar contraseña (pide la contraseña actual como confirmación)
app.put('/api/profile/password', requiereSesion, async (req, res) => {
    const { username } = req.session.user;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Faltan datos obligatorios' });
    }
    if (newPassword.length < 6) {
        return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
    }

    db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        const match = await bcrypt.compare(currentPassword, user.password);
        if (!match) return res.status(400).json({ error: 'La contraseña actual es incorrecta' });

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        db.run(`UPDATE users SET password = ? WHERE username = ?`, [hashedPassword, username], (err) => {
            if (err) return res.status(500).json({ error: 'Error al actualizar la contraseña' });
            res.json({ message: 'Contraseña actualizada con éxito' });
        });
    });
});

// --- RUTA DE BÚSQUEDA ---

app.get('/api/search', (req, res) => {
    const tipo = (req.query.tipo || '').toLowerCase();
    const q = (req.query.q || '').trim();

    if (!q) {
        return res.json({ implementado: true, resultados: [] });
    }

    if (tipo === 'usuarios') {
        db.all(
            `SELECT username, name FROM users WHERE username LIKE ? OR name LIKE ? LIMIT 10`,
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
        db.all(
            `SELECT title, author FROM books WHERE title LIKE ? OR author LIKE ? LIMIT 10`,
            [`%${q}%`, `%${q}%`],
            (err, rows) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({
                    implementado: true,
                    resultados: rows.map(r => ({ titulo: r.title, subtitulo: r.author }))
                });
            }
        );
    } else {
        // editoriales, mangas, novelas-ligeras: todavía no tienen tabla propia
        res.json({ implementado: false, resultados: [] });
    }
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