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

    // Reseñas: funcionalidad TOTALMENTE separada de los posts (libro, autor,
    // portada y valoración — sin texto de opinión, según lo pedido).
    db.run(`CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        username TEXT NOT NULL,
        libro_titulo TEXT NOT NULL,
        autor TEXT NOT NULL,
        portada_url TEXT,
        valoracion INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Reacciones a una reseña: like O dislike (una sola por persona, se puede cambiar)
    db.run(`CREATE TABLE IF NOT EXISTS review_reactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        review_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        tipo TEXT NOT NULL CHECK(tipo IN ('like','dislike')),
        UNIQUE(review_id, user_id)
    )`);

    // Seguir: asimétrico y sin permiso (como Twitter/X). Totalmente separado de amigos.
    db.run(`CREATE TABLE IF NOT EXISTS follows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        follower_id INTEGER NOT NULL,
        followed_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(follower_id, followed_id)
    )`);

    // Amigos: simétrico, requiere solicitud + aceptación (como Facebook).
    // estado: 'pendiente' | 'aceptada'. Rechazar/cancelar simplemente borra la fila.
    db.run(`CREATE TABLE IF NOT EXISTS friend_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_user_id INTEGER NOT NULL,
        to_user_id INTEGER NOT NULL,
        estado TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','aceptada')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(from_user_id, to_user_id)
    )`);

    // Estanterías / colecciones de libros: cada usuario arma sus propias estanterías
    // con nombre (ej: "Leídos", "Quiero leer", "Favoritos", o una personalizada),
    // y en cada una va agregando libros (título/autor/portada — sin depender de un
    // catálogo formal, igual que las reseñas).
    db.run(`CREATE TABLE IF NOT EXISTS shelves (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        nombre TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS shelf_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shelf_id INTEGER NOT NULL,
        libro_titulo TEXT NOT NULL,
        autor TEXT NOT NULL,
        portada_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Notificaciones: le avisan a un usuario que alguien hizo algo relacionado con
    // él (le dieron like, comentaron, lo siguieron, le mandaron solicitud, etc).
    db.run(`CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        actor_username TEXT NOT NULL,
        mensaje TEXT NOT NULL,
        leida INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Progreso de lectura: libros que estás leyendo AHORA, con página actual.
    // Separado de las estanterías (esas son colecciones fijas, esto es algo vivo
    // que cambia mientras vas leyendo).
    db.run(`CREATE TABLE IF NOT EXISTS lecturas_en_curso (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        libro_titulo TEXT NOT NULL,
        autor TEXT NOT NULL,
        portada_url TEXT,
        pagina_actual INTEGER NOT NULL DEFAULT 0,
        paginas_totales INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
            db.get(`SELECT user_id FROM posts WHERE id = ?`, [id], (err, post) => {
                if (post) crearNotificacion(post.user_id, req.session.user.username, `${req.session.user.username} comentó tu publicación`);
            });
            notificarMenciones(content.trim(), req.session.user.username, 'un comentario');
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
                db.get(`SELECT user_id FROM posts WHERE id = ?`, [id], (err, post) => {
                    if (post) crearNotificacion(post.user_id, req.session.user.username, `A ${req.session.user.username} le gustó tu publicación`);
                });
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
                db.get(`SELECT user_id FROM posts WHERE id = ?`, [id], (err, post) => {
                    if (post) crearNotificacion(post.user_id, req.session.user.username, `${req.session.user.username} republicó tu publicación`);
                });
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
        notificarMenciones(content, username, 'una publicación');
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

// Crea una notificación para userId, salvo que sea la misma persona que hizo la
// acción (no tiene sentido notificarte a ti mismo por darte like a tu propio post).
function crearNotificacion(userId, actorUsername, mensaje) {
    if (!userId) return;
    db.get(`SELECT username FROM users WHERE id = ?`, [userId], (err, destinatario) => {
        if (err || !destinatario) return;
        if (destinatario.username === actorUsername) return; // no te notifiques a ti mismo
        db.run(
            `INSERT INTO notifications (user_id, actor_username, mensaje) VALUES (?, ?, ?)`,
            [userId, actorUsername, mensaje]
        );
    });
}

// Busca @menciones en un texto (ej: "hola @takato, ¿leíste esto?") y le manda una
// notificación a cada usuario válido mencionado (si existe, y si no es él mismo).
function notificarMenciones(texto, actorUsername, tipoLugar) {
    const nombres = [...new Set((texto.match(/@(\w+)/g) || []).map(m => m.slice(1)))];
    nombres.forEach(nombre => {
        if (nombre === actorUsername) return;
        db.get(`SELECT id FROM users WHERE username = ?`, [nombre], (err, user) => {
            if (err || !user) return;
            crearNotificacion(user.id, actorUsername, `${actorUsername} te mencionó en ${tipoLugar}`);
        });
    });
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

// --- RUTAS DE SEGUIR (asimétrico, sin permiso — separado de amigos) ---

// Seguir / dejar de seguir a alguien (toggle)
app.post('/api/follow/:username', requiereSesion, (req, res) => {
    const miId = req.session.user.id;
    const { username } = req.params;

    if (username === req.session.user.username) {
        return res.status(400).json({ error: 'No puedes seguirte a ti mismo' });
    }

    db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, otro) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!otro) return res.status(404).json({ error: 'Usuario no encontrado' });

        db.get(`SELECT id FROM follows WHERE follower_id = ? AND followed_id = ?`, [miId, otro.id], (err, existente) => {
            if (err) return res.status(500).json({ error: 'Error en el servidor' });

            if (existente) {
                db.run(`DELETE FROM follows WHERE id = ?`, [existente.id], (err) => {
                    if (err) return res.status(500).json({ error: 'Error en el servidor' });
                    res.json({ siguiendo: false });
                });
            } else {
                db.run(`INSERT INTO follows (follower_id, followed_id) VALUES (?, ?)`, [miId, otro.id], (err) => {
                    if (err) return res.status(500).json({ error: 'Error en el servidor' });
                    crearNotificacion(otro.id, req.session.user.username, `${req.session.user.username} empezó a seguirte`);
                    res.json({ siguiendo: true });
                });
            }
        });
    });
});

// Perfil de "seguir": cuántos seguidores/seguidos tiene, listas, y si YO lo sigo
app.get('/api/users/:username/seguir-info', (req, res) => {
    const { username } = req.params;
    const miId = req.session.user ? req.session.user.id : null;

    db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, user) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        db.all(
            `SELECT users.username FROM follows JOIN users ON users.id = follows.follower_id WHERE follows.followed_id = ? ORDER BY follows.id DESC`,
            [user.id],
            (err, seguidores) => {
                if (err) return res.status(500).json({ error: 'Error en el servidor' });

                db.all(
                    `SELECT users.username FROM follows JOIN users ON users.id = follows.followed_id WHERE follows.follower_id = ? ORDER BY follows.id DESC`,
                    [user.id],
                    (err, seguidos) => {
                        if (err) return res.status(500).json({ error: 'Error en el servidor' });

                        db.get(`SELECT id FROM follows WHERE follower_id = ? AND followed_id = ?`, [miId, user.id], (err, yoLoSigo) => {
                            if (err) return res.status(500).json({ error: 'Error en el servidor' });
                            res.json({
                                seguidores: seguidores.map(r => r.username),
                                seguidos: seguidos.map(r => r.username),
                                yoLoSigo: !!yoLoSigo
                            });
                        });
                    }
                );
            }
        );
    });
});

// --- RUTAS DE AMIGOS (simétrico, con solicitud + aceptación — separado de seguir) ---

// Enviar solicitud de amistad
app.post('/api/friends/:username/solicitar', requiereSesion, (req, res) => {
    const miId = req.session.user.id;
    const { username } = req.params;

    if (username === req.session.user.username) {
        return res.status(400).json({ error: 'No puedes agregarte a ti mismo' });
    }

    db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, otro) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!otro) return res.status(404).json({ error: 'Usuario no encontrado' });

        // Si el otro ya te había mandado una solicitud a ti, la aceptamos directo (como Facebook)
        db.get(
            `SELECT id, estado FROM friend_requests WHERE from_user_id = ? AND to_user_id = ?`,
            [otro.id, miId],
            (err, inversa) => {
                if (err) return res.status(500).json({ error: 'Error en el servidor' });

                if (inversa) {
                    db.run(`UPDATE friend_requests SET estado = 'aceptada' WHERE id = ?`, [inversa.id], (err) => {
                        if (err) return res.status(500).json({ error: 'Error en el servidor' });
                        crearNotificacion(otro.id, req.session.user.username, `Tú y ${req.session.user.username} ahora son amigos`);
                        res.json({ estado: 'amigos' });
                    });
                    return;
                }

                db.run(
                    `INSERT INTO friend_requests (from_user_id, to_user_id, estado) VALUES (?, ?, 'pendiente')`,
                    [miId, otro.id],
                    (err) => {
                        if (err) return res.status(400).json({ error: 'Ya existe una solicitud con este usuario' });
                        crearNotificacion(otro.id, req.session.user.username, `${req.session.user.username} te envió una solicitud de amistad`);
                        res.json({ estado: 'solicitud_enviada' });
                    }
                );
            }
        );
    });
});

// Aceptar una solicitud que ME mandaron
app.post('/api/friends/:username/aceptar', requiereSesion, (req, res) => {
    const miId = req.session.user.id;
    const { username } = req.params;

    db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, otro) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!otro) return res.status(404).json({ error: 'Usuario no encontrado' });

        db.run(
            `UPDATE friend_requests SET estado = 'aceptada' WHERE from_user_id = ? AND to_user_id = ? AND estado = 'pendiente'`,
            [otro.id, miId],
            function(err) {
                if (err) return res.status(500).json({ error: 'Error en el servidor' });
                if (this.changes === 0) return res.status(404).json({ error: 'No hay ninguna solicitud pendiente de esa persona' });
                crearNotificacion(otro.id, req.session.user.username, `${req.session.user.username} aceptó tu solicitud de amistad`);
                res.json({ estado: 'amigos' });
            }
        );
    });
});

// Rechazar una solicitud recibida, cancelar una que enviaste, o eliminar una amistad ya existente
app.delete('/api/friends/:username', requiereSesion, (req, res) => {
    const miId = req.session.user.id;
    const { username } = req.params;

    db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, otro) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!otro) return res.status(404).json({ error: 'Usuario no encontrado' });

        db.run(
            `DELETE FROM friend_requests WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)`,
            [miId, otro.id, otro.id, miId],
            (err) => {
                if (err) return res.status(500).json({ error: 'Error en el servidor' });
                res.json({ estado: 'ninguno' });
            }
        );
    });
});

// Estado de amistad entre TÚ y un usuario, además de su lista de amigos
app.get('/api/users/:username/amigos-info', (req, res) => {
    const { username } = req.params;
    const miId = req.session.user ? req.session.user.id : null;

    db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, user) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        db.all(
            `SELECT users.username
             FROM friend_requests
             JOIN users ON users.id = CASE WHEN friend_requests.from_user_id = ? THEN friend_requests.to_user_id ELSE friend_requests.from_user_id END
             WHERE (friend_requests.from_user_id = ? OR friend_requests.to_user_id = ?) AND friend_requests.estado = 'aceptada'`,
            [user.id, user.id, user.id],
            (err, amigos) => {
                if (err) return res.status(500).json({ error: 'Error en el servidor' });

                if (!miId || miId === user.id) {
                    return res.json({ amigos: amigos.map(r => r.username), estado: miId ? 'yo_mismo' : 'sin_sesion' });
                }

                db.get(
                    `SELECT estado, from_user_id FROM friend_requests WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)`,
                    [miId, user.id, user.id, miId],
                    (err, relacion) => {
                        if (err) return res.status(500).json({ error: 'Error en el servidor' });

                        let estado = 'ninguno';
                        if (relacion) {
                            if (relacion.estado === 'aceptada') estado = 'amigos';
                            else estado = relacion.from_user_id === miId ? 'solicitud_enviada' : 'solicitud_recibida';
                        }

                        res.json({ amigos: amigos.map(r => r.username), estado });
                    }
                );
            }
        );
    });
});

// --- RUTAS DE PROGRESO DE LECTURA ---

// Lecturas en curso de CUALQUIER usuario — pública
app.get('/api/users/:username/lecturas', (req, res) => {
    const { username } = req.params;
    db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, user) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        db.all(
            `SELECT id, libro_titulo, autor, portada_url, pagina_actual, paginas_totales, updated_at
             FROM lecturas_en_curso WHERE user_id = ? ORDER BY updated_at DESC`,
            [user.id],
            (err, rows) => {
                if (err) return res.status(500).json({ error: 'Error en el servidor' });
                res.json({ lecturas: rows });
            }
        );
    });
});

// Empezar una lectura nueva
app.post('/api/lecturas', requiereSesion, (req, res) => {
    const { libro_titulo, autor, portada_url, paginas_totales } = req.body;
    const totales = parseInt(paginas_totales, 10);

    if (!libro_titulo || !autor || !totales || totales < 1) {
        return res.status(400).json({ error: 'Completa título, autor y el total de páginas' });
    }

    db.run(
        `INSERT INTO lecturas_en_curso (user_id, libro_titulo, autor, portada_url, pagina_actual, paginas_totales) VALUES (?, ?, ?, ?, 0, ?)`,
        [req.session.user.id, libro_titulo, autor, portada_url || null, totales],
        function(err) {
            if (err) return res.status(500).json({ error: 'Error en el servidor' });
            res.status(201).json({ message: 'Lectura agregada', lecturaId: this.lastID });
        }
    );
});

// Actualizar la página actual (y, si se pide, compartirlo como post automático)
app.put('/api/lecturas/:id', requiereSesion, (req, res) => {
    const { id } = req.params;
    const { pagina_actual, compartir } = req.body;
    const pagina = parseInt(pagina_actual, 10);

    if (isNaN(pagina) || pagina < 0) {
        return res.status(400).json({ error: 'Página inválida' });
    }

    db.get(`SELECT * FROM lecturas_en_curso WHERE id = ?`, [id], (err, lectura) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!lectura) return res.status(404).json({ error: 'Lectura no encontrada' });
        if (lectura.user_id !== req.session.user.id) {
            return res.status(403).json({ error: 'No puedes modificar lecturas de otros usuarios' });
        }
        if (pagina > lectura.paginas_totales) {
            return res.status(400).json({ error: `Esa página supera el total del libro (${lectura.paginas_totales})` });
        }

        db.run(
            `UPDATE lecturas_en_curso SET pagina_actual = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [pagina, id],
            (err) => {
                if (err) return res.status(500).json({ error: 'Error en el servidor' });

                if (compartir) {
                    const { username } = req.session.user;
                    const contenido = `📖 Voy en la página ${pagina} de ${lectura.paginas_totales} de "${lectura.libro_titulo}"`;
                    db.run(
                        `INSERT INTO posts (user_id, username, content, tag) VALUES (?, ?, ?, ?)`,
                        [req.session.user.id, username, contenido, lectura.autor]
                    );
                }

                res.json({ message: 'Progreso actualizado', pagina_actual: pagina });
            }
        );
    });
});

// Quitar una lectura en curso (terminada o abandonada)
app.delete('/api/lecturas/:id', requiereSesion, (req, res) => {
    const { id } = req.params;
    db.get(`SELECT user_id FROM lecturas_en_curso WHERE id = ?`, [id], (err, lectura) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!lectura) return res.status(404).json({ error: 'Lectura no encontrada' });
        if (lectura.user_id !== req.session.user.id) {
            return res.status(403).json({ error: 'No puedes eliminar lecturas de otros usuarios' });
        }
        db.run(`DELETE FROM lecturas_en_curso WHERE id = ?`, [id], (err) => {
            if (err) return res.status(500).json({ error: 'Error en el servidor' });
            res.json({ message: 'Lectura eliminada' });
        });
    });
});

// --- RUTA DE INSIGNIAS / LOGROS ---
// Se calculan al vuelo según tu actividad real (no se guardan aparte, así
// siempre reflejan el estado actual sin desincronizarse).
app.get('/api/users/:username/badges', (req, res) => {
    const { username } = req.params;

    db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, user) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        const contar = (sql, params) => new Promise((resolve) => {
            db.get(sql, params, (err, row) => resolve(err ? 0 : row.n));
        });

        Promise.all([
            contar(`SELECT COUNT(*) AS n FROM posts WHERE user_id = ?`, [user.id]),
            contar(`SELECT COUNT(*) AS n FROM reviews WHERE user_id = ?`, [user.id]),
            contar(
                `SELECT COUNT(*) AS n FROM friend_requests WHERE (from_user_id = ? OR to_user_id = ?) AND estado = 'aceptada'`,
                [user.id, user.id]
            ),
            contar(`SELECT COUNT(*) AS n FROM follows WHERE followed_id = ?`, [user.id]),
            contar(
                `SELECT COUNT(*) AS n FROM shelf_items JOIN shelves ON shelves.id = shelf_items.shelf_id WHERE shelves.user_id = ?`,
                [user.id]
            )
        ]).then(([posts, reviews, amigos, seguidores, librosEnEstantes]) => {
            const badges = [
                { nombre: 'Primera Publicación', icono: '📝', desbloqueada: posts >= 1, descripcion: 'Publica tu primer post' },
                { nombre: 'Publicador Activo', icono: '📚', desbloqueada: posts >= 10, descripcion: 'Publica 10 posts' },
                { nombre: 'Primera Reseña', icono: '⭐', desbloqueada: reviews >= 1, descripcion: 'Publica tu primera reseña' },
                { nombre: 'Crítico Literario', icono: '🏆', desbloqueada: reviews >= 5, descripcion: 'Publica 5 reseñas' },
                { nombre: 'Primer Amigo', icono: '🤝', desbloqueada: amigos >= 1, descripcion: 'Agrega tu primer amigo' },
                { nombre: 'Sociable', icono: '🎉', desbloqueada: amigos >= 5, descripcion: 'Ten 5 amigos' },
                { nombre: 'Popular', icono: '🌟', desbloqueada: seguidores >= 10, descripcion: 'Consigue 10 seguidores' },
                { nombre: 'Lector', icono: '📖', desbloqueada: librosEnEstantes >= 1, descripcion: 'Agrega un libro a una estantería' }
            ];
            res.json({ badges });
        });
    });
});

// --- RUTAS DE NOTIFICACIONES ---

// Últimas notificaciones propias + cuántas no leídas
app.get('/api/notifications', requiereSesion, (req, res) => {
    const userId = req.session.user.id;
    db.all(
        `SELECT id, actor_username, mensaje, leida, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 20`,
        [userId],
        (err, rows) => {
            if (err) return res.status(500).json({ error: 'Error en el servidor' });
            db.get(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND leida = 0`, [userId], (err, row) => {
                if (err) return res.status(500).json({ error: 'Error en el servidor' });
                res.json({ notifications: rows, noLeidas: row.n });
            });
        }
    );
});

// Marcar todas como leídas (se llama al abrir el panel de notificaciones)
app.post('/api/notifications/marcar-leidas', requiereSesion, (req, res) => {
    db.run(`UPDATE notifications SET leida = 1 WHERE user_id = ? AND leida = 0`, [req.session.user.id], (err) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        res.json({ message: 'Notificaciones marcadas como leídas' });
    });
});

// --- RUTAS DE ESTANTERÍAS / COLECCIONES DE LIBROS ---

// Trae las estanterías (con sus libros) de CUALQUIER usuario, por nombre — pública.
// Si el que pregunta es el dueño y todavía no tiene ninguna, le creamos 3 por defecto.
app.get('/api/users/:username/shelves', (req, res) => {
    const { username } = req.params;
    const miId = req.session.user ? req.session.user.id : null;

    db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, user) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        const traerEstanterias = () => {
            db.all(`SELECT id, nombre FROM shelves WHERE user_id = ? ORDER BY id ASC`, [user.id], (err, estantes) => {
                if (err) return res.status(500).json({ error: 'Error en el servidor' });
                if (estantes.length === 0) return res.json({ shelves: [] });

                let pendientes = estantes.length;
                estantes.forEach(estante => {
                    db.all(
                        `SELECT id, libro_titulo, autor, portada_url FROM shelf_items WHERE shelf_id = ? ORDER BY id DESC`,
                        [estante.id],
                        (err, libros) => {
                            estante.libros = err ? [] : libros;
                            pendientes--;
                            if (pendientes === 0) res.json({ shelves: estantes });
                        }
                    );
                });
            });
        };

        const esDueno = miId === user.id;
        if (!esDueno) return traerEstanterias();

        db.get(`SELECT COUNT(*) AS n FROM shelves WHERE user_id = ?`, [user.id], (err, row) => {
            if (err) return res.status(500).json({ error: 'Error en el servidor' });
            if (row.n > 0) return traerEstanterias();

            const porDefecto = ['Leídos', 'Quiero leer', 'Favoritos'];
            let creadas = 0;
            porDefecto.forEach(nombre => {
                db.run(`INSERT INTO shelves (user_id, nombre) VALUES (?, ?)`, [user.id, nombre], () => {
                    creadas++;
                    if (creadas === porDefecto.length) traerEstanterias();
                });
            });
        });
    });
});

// Crear una estantería nueva (propia)
app.post('/api/shelves', requiereSesion, (req, res) => {
    const { nombre } = req.body;
    if (!nombre || !nombre.trim()) {
        return res.status(400).json({ error: 'La estantería necesita un nombre' });
    }
    db.run(`INSERT INTO shelves (user_id, nombre) VALUES (?, ?)`, [req.session.user.id, nombre.trim()], function(err) {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        res.status(201).json({ message: 'Estantería creada', shelfId: this.lastID });
    });
});

// Eliminar una estantería propia (y los libros que tenía adentro)
app.delete('/api/shelves/:id', requiereSesion, (req, res) => {
    const { id } = req.params;
    db.get(`SELECT user_id FROM shelves WHERE id = ?`, [id], (err, estante) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!estante) return res.status(404).json({ error: 'Estantería no encontrada' });
        if (estante.user_id !== req.session.user.id) {
            return res.status(403).json({ error: 'No puedes eliminar estanterías de otros usuarios' });
        }
        db.run(`DELETE FROM shelves WHERE id = ?`, [id], (err) => {
            if (err) return res.status(500).json({ error: 'Error en el servidor' });
            db.run(`DELETE FROM shelf_items WHERE shelf_id = ?`, [id]);
            res.json({ message: 'Estantería eliminada' });
        });
    });
});

// Agregar un libro a una estantería propia
app.post('/api/shelves/:id/items', requiereSesion, (req, res) => {
    const { id } = req.params;
    const { libro_titulo, autor, portada_url } = req.body;

    if (!libro_titulo || !autor) {
        return res.status(400).json({ error: 'Completa al menos título y autor' });
    }

    db.get(`SELECT user_id FROM shelves WHERE id = ?`, [id], (err, estante) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!estante) return res.status(404).json({ error: 'Estantería no encontrada' });
        if (estante.user_id !== req.session.user.id) {
            return res.status(403).json({ error: 'No puedes agregar libros a estanterías de otros usuarios' });
        }
        db.run(
            `INSERT INTO shelf_items (shelf_id, libro_titulo, autor, portada_url) VALUES (?, ?, ?, ?)`,
            [id, libro_titulo, autor, portada_url || null],
            function(err) {
                if (err) return res.status(500).json({ error: 'Error en el servidor' });
                res.status(201).json({ message: 'Libro agregado', itemId: this.lastID });
            }
        );
    });
});

// Quitar un libro de una estantería propia
app.delete('/api/shelf-items/:id', requiereSesion, (req, res) => {
    const { id } = req.params;
    db.get(
        `SELECT shelves.user_id FROM shelf_items JOIN shelves ON shelves.id = shelf_items.shelf_id WHERE shelf_items.id = ?`,
        [id],
        (err, fila) => {
            if (err) return res.status(500).json({ error: 'Error en el servidor' });
            if (!fila) return res.status(404).json({ error: 'Libro no encontrado' });
            if (fila.user_id !== req.session.user.id) {
                return res.status(403).json({ error: 'No puedes modificar estanterías de otros usuarios' });
            }
            db.run(`DELETE FROM shelf_items WHERE id = ?`, [id], (err) => {
                if (err) return res.status(500).json({ error: 'Error en el servidor' });
                res.json({ message: 'Libro eliminado de la estantería' });
            });
        }
    );
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

// --- RUTAS DE RESEÑAS (funcionalidad separada de los posts) ---

// Listar reseñas recientes, con sus contadores y tu propia reacción si tienes sesión
app.get('/api/reviews', (req, res) => {
    const miId = req.session.user ? req.session.user.id : null;
    const { username } = req.query;

    const baseQuery = `
        SELECT
            reviews.id, reviews.user_id, reviews.libro_titulo, reviews.autor,
            reviews.portada_url, reviews.valoracion, reviews.created_at,
            COALESCE(users.username, reviews.username) AS username,
            (SELECT COUNT(*) FROM review_reactions WHERE review_id = reviews.id AND tipo = 'like') AS likes_count,
            (SELECT COUNT(*) FROM review_reactions WHERE review_id = reviews.id AND tipo = 'dislike') AS dislikes_count,
            (SELECT tipo FROM review_reactions WHERE review_id = reviews.id AND user_id = ?) AS mi_reaccion
        FROM reviews
        LEFT JOIN users ON reviews.user_id = users.id
    `;

    if (username) {
        db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, user) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!user) return res.json({ reviews: [] });

            db.all(`${baseQuery} WHERE reviews.user_id = ? ORDER BY reviews.id DESC`, [miId, user.id], (err, rows) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ reviews: rows });
            });
        });
    } else {
        db.all(`${baseQuery} ORDER BY reviews.id DESC LIMIT 20`, [miId], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ reviews: rows });
        });
    }
});

// Crear una reseña: título, autor, portada (opcional) y valoración 1-5. Sin texto de opinión.
app.post('/api/reviews', requiereSesion, (req, res) => {
    const { id: userId, username } = req.session.user;
    const { libro_titulo, autor, portada_url, valoracion } = req.body;
    const val = parseInt(valoracion, 10);

    if (!libro_titulo || !autor || !val || val < 1 || val > 5) {
        return res.status(400).json({ error: 'Completa título, autor y una valoración entre 1 y 5.' });
    }

    db.run(
        `INSERT INTO reviews (user_id, username, libro_titulo, autor, portada_url, valoracion) VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, username, libro_titulo, autor, portada_url || null, val],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.status(201).json({ message: 'Reseña publicada con éxito', reviewId: this.lastID });
        }
    );
});

// Eliminar una reseña propia
app.delete('/api/reviews/:id', requiereSesion, (req, res) => {
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
            res.json({ message: 'Reseña eliminada con éxito' });
        });
    });
});

// Dar/quitar/cambiar like o dislike a una reseña (una sola reacción por persona)
app.post('/api/reviews/:id/reaccionar', requiereSesion, (req, res) => {
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
                        crearNotificacion(review.user_id, req.session.user.username, `A ${req.session.user.username} ${verbo} tu reseña`);
                    }
                });
                responderConContadores();
            });
        }
    });
});

// --- TRENDING: los tags más usados en los posts recientes ---
app.get('/api/trending', (req, res) => {
    db.all(
        `SELECT tag, COUNT(*) AS cantidad
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