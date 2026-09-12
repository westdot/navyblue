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

    // user_id: ligamos cada post a la CUENTA (id fijo), no al nombre de usuario
    // (que puede cambiar). Así, aunque cambies tu username, tus posts te siguen
    // perteneciendo. "username" se sigue guardando como respaldo, pero al leer
    // los posts se prioriza el nombre ACTUAL de la cuenta vía este id.
    db.run(`ALTER TABLE posts ADD COLUMN user_id INTEGER`, (err) => {
        console.log('[DEBUG] ALTER posts.user_id:', err ? err.message : 'OK, columna agregada');
    });
    // Enlazamos lo que se pueda: posts cuyo "username" guardado coincide con el
    // username ACTUAL de alguna cuenta. Los posts publicados con un nombre que
    // ya cambiaste antes de este arreglo no se pueden enlazar automáticamente
    // (no queda registro de tus nombres anteriores) y quedarán con user_id vacío.
    db.run(`UPDATE posts SET user_id = (SELECT id FROM users WHERE users.username = posts.username) WHERE user_id IS NULL`, (err) => {
        console.log('[DEBUG] Backfill posts.user_id:', err ? err.message : 'OK');
    });

    // Comentarios, likes y reposteos de cada publicación
    db.run(`CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL,
        user_id INTEGER,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // UNIQUE(post_id, user_id): cada cuenta solo puede dar un like / repostear una vez por post
    db.run(`CREATE TABLE IF NOT EXISTS likes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(post_id, user_id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS reposts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(post_id, user_id)
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
// Convierte los contadores 0/1 de SQLite en booleanos reales
function normalizarPost(row) {
    return {
        ...row,
        liked_by_me: !!row.liked_by_me,
        reposted_by_me: !!row.reposted_by_me
    };
}

app.get('/api/posts', (req, res) => {
    const { username } = req.query;
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

    if (username) {
        // Buscamos el id de la cuenta a partir del username actual, y filtramos por ESE id
        // (así se incluyen todos sus posts, aunque algunos se hayan guardado con otro nombre)
        db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, user) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!user) return res.json({ posts: [] });

            db.all(`${baseQuery} WHERE posts.user_id = ? ORDER BY posts.id DESC`, [miId, miId, user.id], (err, rows) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ posts: rows.map(normalizarPost) });
            });
        });
    } else {
        db.all(`${baseQuery} ORDER BY posts.id DESC`, [miId, miId], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ posts: rows.map(normalizarPost) });
        });
    }
});

// Obtener el detalle de UN post (para abrirlo con sus comentarios)
app.get('/api/posts/:id', (req, res) => {
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

// --- COMENTARIOS ---

app.get('/api/posts/:id/comments', (req, res) => {
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

app.post('/api/posts/:id/comments', requiereSesion, (req, res) => {
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
            res.status(201).json({ message: 'Comentario agregado', commentId: this.lastID });
        }
    );
});

app.delete('/api/comments/:id', requiereSesion, (req, res) => {
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

// --- LIKES ---

app.post('/api/posts/:id/like', requiereSesion, (req, res) => {
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
                terminar(true);
            });
        }
    });
});

// --- REPOSTEOS ---

app.post('/api/posts/:id/repost', requiereSesion, (req, res) => {
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
                terminar(true);
            });
        }
    });
});

// Crear una nueva publicación
app.post('/api/posts', (req, res) => {
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
        res.status(201).json({ 
            message: 'Publicación creada con éxito', 
            postId: this.lastID 
        });
    });
});

// Eliminar una publicación: solo el dueño de la cuenta que la creó puede borrarla
app.delete('/api/posts/:id', requiereSesion, (req, res) => {
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
            id: user.id,
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

// Perfil PÚBLICO de cualquier usuario (nombre, país, fecha de registro) — para
// poder mostrar el muro de otras personas, sin exponer correo ni datos privados
app.get('/api/users/:username', (req, res) => {
    db.get(`SELECT name, username, pais, created_at FROM users WHERE username = ?`, [req.params.username], (err, user) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
        res.json({ user });
    });
});

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
        req.session.user = { id: req.session.user.id, name, username, email };
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