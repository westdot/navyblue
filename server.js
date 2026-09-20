require('dotenv').config();
const express = require('express');
const { Pool, types } = require('pg');
const bcrypt = require('bcrypt');
const path = require('path');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3000;

// middleware para parsear JSON y servir archivos estaticos
// límite subido de 100kb a 3mb: necesario para poder guardar la foto de
// perfil como data URL (base64) directo en la base de datos, sin depender
// de un servicio externo de almacenamiento de archivos.
app.use(express.json({ limit: '3mb' }));
app.use(express.static(path.join(__dirname, 'public'))); // se asume que los archivos HTML/CSS estan en una carpeta 'public'

// middleware de sesión: el servidor recuerda quién inicio sesion mediante una cookie firmada
app.use(session({
    secret: process.env.SESSION_SECRET || 'cambia-esto-por-una-frase-larga-y-secreta',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24, // la sesión dura 24 horas
        httpOnly: true
        // secure: true  // descomenta esto cuando se sirve el sitio con HTTPS
    }
}));

// --- CONEXIÓN A LA BASE DE DATOS (PostgreSQL en Neon) ---
// DATABASE_URL viene de una variable de entorno:
//   - En tu PC: ponla en un archivo .env (ver .env.example)
//   - En Render: Settings -> Environment -> Add Environment Variable
if (!process.env.DATABASE_URL) {
    console.error('¡Falta la variable de entorno DATABASE_URL! Revisa tu archivo .env (o la configuración en Render).');
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Neon requiere conexión con SSL
});

// PostgreSQL devuelve los resultados de COUNT(*) como texto (tipo "bigint"), para
// no perder precisión en números gigantes. Como en este proyecto ningún contador
// se acerca a ese límite, los convertimos siempre a un número normal de JS —
// si no hiciéramos esto, cosas como "liked_by_me" (0 o 1 como texto) se
// evaluarían siempre como verdaderas en el frontend.
types.setTypeParser(20, (val) => parseInt(val, 10));

pool.query('SELECT NOW()')
    .then(() => console.log('Conectado a la base de datos PostgreSQL (Neon).'))
    .catch((err) => console.error('Error al conectar con la base de datos:', err.message));

// --- CAPA DE COMPATIBILIDAD CON LA API DE sqlite3 ---
// Todo el resto de este archivo (más abajo) sigue escrito EXACTAMENTE igual que
// antes: usa "?" como placeholders y callbacks al estilo sqlite3
// (db.run/db.get/db.all). Este pequeño adaptador traduce esas mismas llamadas
// para que funcionen contra PostgreSQL, así no fue necesario reescribir cada
// una de las consultas del archivo.
function aPlaceholdersPg(sql) {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
}

const db = {
    // Para INSERT/UPDATE/DELETE. Imita this.lastID y this.changes de sqlite3.
    run(sql, params, callback) {
        if (typeof params === 'function') { callback = params; params = []; }
        params = params || [];

        let consulta = aPlaceholdersPg(sql);
        const esInsert = /^\s*insert/i.test(consulta);
        // Todas las tablas de este proyecto usan "id" como clave primaria,
        // así que podemos agregar RETURNING id automáticamente a cada INSERT
        // para poder devolver this.lastID como antes.
        if (esInsert && !/returning/i.test(consulta)) {
            consulta += ' RETURNING id';
        }

        pool.query(consulta, params)
            .then((resultado) => {
                const contexto = {
                    lastID: esInsert && resultado.rows[0] ? resultado.rows[0].id : undefined,
                    changes: resultado.rowCount
                };
                if (callback) callback.call(contexto, null);
            })
            .catch((err) => {
                if (callback) callback.call({}, err);
                else console.error('Error en db.run:', err.message);
            });
    },

    // Para SELECT que devuelven una sola fila (o ninguna)
    get(sql, params, callback) {
        if (typeof params === 'function') { callback = params; params = []; }
        params = params || [];
        pool.query(aPlaceholdersPg(sql), params)
            .then((resultado) => callback(null, resultado.rows[0]))
            .catch((err) => callback(err));
    },

    // Para SELECT que devuelven varias filas
    all(sql, params, callback) {
        if (typeof params === 'function') { callback = params; params = []; }
        params = params || [];
        pool.query(aPlaceholdersPg(sql), params)
            .then((resultado) => callback(null, resultado.rows))
            .catch((err) => callback(err));
    }
};

// --- CREACIÓN DE TABLAS (equivalente al db.serialize(...) de antes) ---
async function crearTablas() {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            pais TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        // migracion: si la tabla ya existia de antes (sin estas columnas), las agregamos
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pais TEXT`);
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP`);
        await pool.query(`UPDATE users SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL`);
        // foto de perfil: se guarda como data URL (base64), no como archivo en disco
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS foto_url TEXT`);
        // foto de portada (fondo del muro): mismo esquema que foto_url
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS fondo_url TEXT`);

        await pool.query(`CREATE TABLE IF NOT EXISTS posts (
            id SERIAL PRIMARY KEY,
            username TEXT NOT NULL,
            content TEXT NOT NULL,
            tag TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        // user_id: ligamos cada post a la CUENTA (id fijo), no al nombre de usuario
        await pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS user_id INTEGER`);
        await pool.query(`UPDATE posts SET user_id = (SELECT id FROM users WHERE users.username = posts.username) WHERE user_id IS NULL`);

        // Comentarios, likes y reposteos de cada publicación
        await pool.query(`CREATE TABLE IF NOT EXISTS comments (
            id SERIAL PRIMARY KEY,
            post_id INTEGER NOT NULL,
            user_id INTEGER,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS likes (
            id SERIAL PRIMARY KEY,
            post_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(post_id, user_id)
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS reposts (
            id SERIAL PRIMARY KEY,
            post_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(post_id, user_id)
        )`);

        // Reseñas: funcionalidad separada de los posts
        await pool.query(`CREATE TABLE IF NOT EXISTS reviews (
            id SERIAL PRIMARY KEY,
            user_id INTEGER,
            username TEXT NOT NULL,
            libro_titulo TEXT NOT NULL,
            autor TEXT NOT NULL,
            portada_url TEXT,
            valoracion INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        // migracion: texto de opinión de la reseña (antes las reseñas solo tenían estrellas)
        await pool.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS texto TEXT`);
        // migracion: la valoración ahora admite medias estrellas (1, 1.5, 2, 2.5... 5)
        await pool.query(`ALTER TABLE reviews ALTER COLUMN valoracion TYPE NUMERIC(2,1)`);

        await pool.query(`CREATE TABLE IF NOT EXISTS review_reactions (
            id SERIAL PRIMARY KEY,
            review_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            tipo TEXT NOT NULL CHECK(tipo IN ('like','dislike')),
            UNIQUE(review_id, user_id)
        )`);

        // Comentarios en reseñas (separado de los comentarios de posts)
        await pool.query(`CREATE TABLE IF NOT EXISTS review_comments (
            id SERIAL PRIMARY KEY,
            review_id INTEGER NOT NULL,
            user_id INTEGER,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        // Seguir: asimétrico y sin permiso
        await pool.query(`CREATE TABLE IF NOT EXISTS follows (
            id SERIAL PRIMARY KEY,
            follower_id INTEGER NOT NULL,
            followed_id INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(follower_id, followed_id)
        )`);

        // Amigos: simétrico, con solicitud + aceptación
        await pool.query(`CREATE TABLE IF NOT EXISTS friend_requests (
            id SERIAL PRIMARY KEY,
            from_user_id INTEGER NOT NULL,
            to_user_id INTEGER NOT NULL,
            estado TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','aceptada')),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(from_user_id, to_user_id)
        )`);

        // Estanterías / colecciones de libros
        await pool.query(`CREATE TABLE IF NOT EXISTS shelves (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            nombre TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS shelf_items (
            id SERIAL PRIMARY KEY,
            shelf_id INTEGER NOT NULL,
            libro_titulo TEXT NOT NULL,
            autor TEXT NOT NULL,
            portada_url TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        // Notificaciones
        await pool.query(`CREATE TABLE IF NOT EXISTS notifications (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            actor_username TEXT NOT NULL,
            mensaje TEXT NOT NULL,
            leida INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        // Progreso de lectura
        await pool.query(`CREATE TABLE IF NOT EXISTS lecturas_en_curso (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            libro_titulo TEXT NOT NULL,
            autor TEXT NOT NULL,
            portada_url TEXT,
            pagina_actual INTEGER NOT NULL DEFAULT 0,
            paginas_totales INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS books (
            id SERIAL PRIMARY KEY,
            title TEXT NOT NULL,
            author TEXT NOT NULL,
            price REAL NOT NULL,
            stock INTEGER NOT NULL
        )`);

        // Meta de libros a leer en el año (una por usuario y año)
        await pool.query(`CREATE TABLE IF NOT EXISTS metas_lectura (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            anio INTEGER NOT NULL,
            meta INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, anio)
        )`);

        // Comentarios en la página de detalle de un libro (no van ligados a
        // una reseña puntual, sino al libro en general: título + autor)
        await pool.query(`CREATE TABLE IF NOT EXISTS book_comments (
            id SERIAL PRIMARY KEY,
            libro_titulo TEXT NOT NULL,
            autor TEXT NOT NULL,
            user_id INTEGER,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        // Mensajes privados: solo entre amigos. Máximo 1 por día por conversación
        // (se resetea al pasar la medianoche del servidor, no cada 24h exactas
        // desde el último mensaje enviado).
        await pool.query(`CREATE TABLE IF NOT EXISTS messages (
            id SERIAL PRIMARY KEY,
            sender_id INTEGER NOT NULL,
            receiver_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        // Preguntas públicas: cualquier usuario puede hacerle una pregunta al día
        // a cada otro usuario. Se muestran en el feed general (index.html) y en
        // el muro de la persona a la que se le preguntó (pestaña "Preguntas").
        await pool.query(`CREATE TABLE IF NOT EXISTS questions (
            id SERIAL PRIMARY KEY,
            asker_id INTEGER NOT NULL,
            asker_username TEXT NOT NULL,
            asked_id INTEGER NOT NULL,
            asked_username TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        console.log('Tablas verificadas/creadas correctamente en PostgreSQL.');
    } catch (err) {
        console.error('Error creando las tablas:', err.message);
    }
}

crearTablas();

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

// Chequea si dos cuentas son amigos (amistad aceptada, en cualquier dirección).
// Se usa para restringir los mensajes privados a solo amigos.
function sonAmigos(idA, idB, callback) {
    db.get(
        `SELECT id FROM friend_requests WHERE estado = 'aceptada' AND ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))`,
        [idA, idB, idB, idA],
        (err, row) => callback(err, !!row)
    );
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
    db.get(`SELECT name, username, pais, created_at, foto_url, fondo_url FROM users WHERE username = ?`, [req.params.username], (err, user) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
        res.json({ user });
    });
});

// Subir/actualizar la foto de perfil (cuadrada, máx. 2MB). Se guarda como
// data URL directo en la base de datos, así que aceptamos strings algo más
// grandes que 2MB (el base64 infla el tamaño ~33%) pero seguimos poniendo un
// techo razonable acá también, por si alguien se salta la validación del navegador.
const LARGO_MAX_FOTO_PERFIL = 2.9 * 1024 * 1024; // ~2.9M caracteres ≈ 2.1MB reales
app.put('/api/profile/foto', requiereSesion, (req, res) => {
    const { foto_url } = req.body;
    const { id: userId } = req.session.user;

    if (!foto_url || typeof foto_url !== 'string' || !foto_url.startsWith('data:image/')) {
        return res.status(400).json({ error: 'La imagen no es válida.' });
    }
    if (foto_url.length > LARGO_MAX_FOTO_PERFIL) {
        return res.status(400).json({ error: 'La imagen pesa más de 2MB.' });
    }

    db.run(`UPDATE users SET foto_url = ? WHERE id = ?`, [foto_url, userId], (err) => {
        if (err) return res.status(500).json({ error: 'No se pudo guardar la foto.' });
        res.json({ message: 'Foto de perfil actualizada', foto_url });
    });
});

// Subir/actualizar la foto de portada (fondo del muro). Mismo esquema que la
// foto de perfil: se guarda como data URL directo en la base de datos.
app.put('/api/profile/fondo', requiereSesion, (req, res) => {
    const { fondo_url } = req.body;
    const { id: userId } = req.session.user;

    if (!fondo_url || typeof fondo_url !== 'string' || !fondo_url.startsWith('data:image/')) {
        return res.status(400).json({ error: 'La imagen no es válida.' });
    }
    if (fondo_url.length > LARGO_MAX_FOTO_PERFIL) {
        return res.status(400).json({ error: 'La imagen pesa más de 2MB.' });
    }

    db.run(`UPDATE users SET fondo_url = ? WHERE id = ?`, [fondo_url, userId], (err) => {
        if (err) return res.status(500).json({ error: 'No se pudo guardar la foto de portada.' });
        res.json({ message: 'Foto de portada actualizada', fondo_url });
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

// --- RUTAS DE MENSAJES (privados, solo entre amigos) ---

const LARGO_MAX_MENSAJE = 1000;

// Lista de conversaciones: una por cada amigo, con el último mensaje (si existe)
// y si hoy ya le mandé un mensaje a esa persona.
app.get('/api/messages', requiereSesion, (req, res) => {
    const miId = req.session.user.id;

    db.all(
        `SELECT users.id, users.username
         FROM friend_requests
         JOIN users ON users.id = CASE WHEN friend_requests.from_user_id = ? THEN friend_requests.to_user_id ELSE friend_requests.from_user_id END
         WHERE (friend_requests.from_user_id = ? OR friend_requests.to_user_id = ?) AND friend_requests.estado = 'aceptada'
         ORDER BY users.username ASC`,
        [miId, miId, miId],
        (err, amigos) => {
            if (err) return res.status(500).json({ error: 'Error en el servidor' });
            if (amigos.length === 0) return res.json({ conversaciones: [] });

            let pendientes = amigos.length;
            const conversaciones = [];

            amigos.forEach(amigo => {
                db.get(
                    `SELECT content, sender_id, created_at FROM messages
                     WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
                     ORDER BY id DESC LIMIT 1`,
                    [miId, amigo.id, amigo.id, miId],
                    (err, ultimo) => {
                        db.get(
                            `SELECT id FROM messages WHERE sender_id = ? AND receiver_id = ? AND created_at::date = CURRENT_DATE`,
                            [miId, amigo.id],
                            (err2, envioHoy) => {
                                conversaciones.push({
                                    username: amigo.username,
                                    ultimo_mensaje: ultimo ? ultimo.content : null,
                                    ultimo_es_mio: ultimo ? ultimo.sender_id === miId : null,
                                    ultimo_created_at: ultimo ? ultimo.created_at : null,
                                    puedo_enviar_hoy: !envioHoy
                                });
                                pendientes--;
                                if (pendientes === 0) {
                                    conversaciones.sort((a, b) => new Date(b.ultimo_created_at || 0) - new Date(a.ultimo_created_at || 0));
                                    res.json({ conversaciones });
                                }
                            }
                        );
                    }
                );
            });
        }
    );
});

// Historial de mensajes con un amigo puntual
app.get('/api/messages/:username', requiereSesion, (req, res) => {
    const miId = req.session.user.id;
    const { username } = req.params;

    if (username === req.session.user.username) {
        return res.status(400).json({ error: 'No puedes enviarte mensajes a ti mismo' });
    }

    db.get(`SELECT id, username FROM users WHERE username = ?`, [username], (err, otro) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!otro) return res.status(404).json({ error: 'Usuario no encontrado' });

        sonAmigos(miId, otro.id, (err, amigos) => {
            if (err) return res.status(500).json({ error: 'Error en el servidor' });
            if (!amigos) return res.status(403).json({ error: 'Solo puedes escribirle a tus amigos' });

            db.all(
                `SELECT id, sender_id, receiver_id, content, created_at FROM messages
                 WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
                 ORDER BY id ASC`,
                [miId, otro.id, otro.id, miId],
                (err, mensajes) => {
                    if (err) return res.status(500).json({ error: 'Error en el servidor' });
                    db.get(
                        `SELECT id FROM messages WHERE sender_id = ? AND receiver_id = ? AND created_at::date = CURRENT_DATE`,
                        [miId, otro.id],
                        (err2, envioHoy) => {
                            res.json({
                                mensajes: mensajes.map(m => ({ ...m, es_mio: m.sender_id === miId })),
                                puedo_enviar_hoy: !envioHoy
                            });
                        }
                    );
                }
            );
        });
    });
});

// Enviar un mensaje: solo a amigos, máx. 1000 caracteres, 1 por día por
// conversación (el límite se resetea a las 00:00 del servidor, no cada 24h
// exactas desde el último mensaje enviado).
app.post('/api/messages/:username', requiereSesion, (req, res) => {
    const miId = req.session.user.id;
    const { username } = req.params;
    const { content } = req.body;

    if (username === req.session.user.username) {
        return res.status(400).json({ error: 'No puedes enviarte mensajes a ti mismo' });
    }
    if (!content || !content.trim()) {
        return res.status(400).json({ error: 'El mensaje no puede estar vacío' });
    }
    if (content.trim().length > LARGO_MAX_MENSAJE) {
        return res.status(400).json({ error: `El mensaje no puede superar los ${LARGO_MAX_MENSAJE} caracteres` });
    }

    db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, otro) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!otro) return res.status(404).json({ error: 'Usuario no encontrado' });

        sonAmigos(miId, otro.id, (err, amigos) => {
            if (err) return res.status(500).json({ error: 'Error en el servidor' });
            if (!amigos) return res.status(403).json({ error: 'Solo puedes escribirle a tus amigos' });

            db.get(
                `SELECT id FROM messages WHERE sender_id = ? AND receiver_id = ? AND created_at::date = CURRENT_DATE`,
                [miId, otro.id],
                (err, envioHoy) => {
                    if (err) return res.status(500).json({ error: 'Error en el servidor' });
                    if (envioHoy) return res.status(429).json({ error: 'Ya le enviaste un mensaje hoy. Podrás volver a escribirle cuando empiece el próximo día.' });

                    db.run(
                        `INSERT INTO messages (sender_id, receiver_id, content) VALUES (?, ?, ?)`,
                        [miId, otro.id, content.trim()],
                        function(err) {
                            if (err) return res.status(500).json({ error: 'Error en el servidor' });
                            crearNotificacion(otro.id, req.session.user.username, `${req.session.user.username} te envió un mensaje`);
                            res.status(201).json({ message: 'Mensaje enviado', mensajeId: this.lastID });
                        }
                    );
                }
            );
        });
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
// Cantidad de libros marcados como "Terminado" durante un año + la meta que el
// usuario se puso para ese año (si existe). Se muestra en el muro, entre
// "Leyendo ahora" e "Insignias". Por defecto usa el año actual.
app.get('/api/users/:username/meta-lectura', (req, res) => {
    const { username } = req.params;
    const anio = parseInt(req.query.anio, 10) || new Date().getFullYear();

    db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, user) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        db.get(`SELECT meta FROM metas_lectura WHERE user_id = ? AND anio = ?`, [user.id, anio], (err, metaRow) => {
            if (err) return res.status(500).json({ error: 'Error en el servidor' });

            db.get(
                `SELECT COUNT(*) AS n
                 FROM shelf_items
                 JOIN shelves ON shelves.id = shelf_items.shelf_id
                 WHERE shelves.user_id = ?
                   AND LOWER(shelves.nombre) = LOWER('Terminado')
                   AND EXTRACT(YEAR FROM shelf_items.created_at) = ?`,
                [user.id, anio],
                (err, row) => {
                    if (err) return res.status(500).json({ error: 'Error en el servidor' });
                    res.json({ anio, meta: metaRow ? metaRow.meta : null, leidos: row.n });
                }
            );
        });
    });
});

// Poner/actualizar tu propia meta de libros para un año (por defecto, el actual)
app.post('/api/meta-lectura', requiereSesion, (req, res) => {
    const userId = req.session.user.id;
    const anio = parseInt(req.body.anio, 10) || new Date().getFullYear();
    const meta = parseInt(req.body.meta, 10);

    if (!meta || meta < 1) {
        return res.status(400).json({ error: 'Ingresa una meta válida (un número entero mayor a 0).' });
    }

    db.run(
        `INSERT INTO metas_lectura (user_id, anio, meta) VALUES (?, ?, ?)
         ON CONFLICT (user_id, anio) DO UPDATE SET meta = EXCLUDED.meta`,
        [userId, anio, meta],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Meta guardada con éxito', anio, meta });
        }
    );
});

// Calcula el array de insignias (SIN porcentaje todavía) para un userId dado.
// Se usa tanto para el usuario que se está consultando como, más abajo, para
// calcular las estadísticas globales (cuánta gente tiene cada una).
function calcularBadgesUsuario(userId) {
    const contar = (sql, params) => new Promise((resolve) => {
        db.get(sql, params, (err, row) => resolve(err ? 0 : row.n));
    });

    // Revisa, para cada año YA TERMINADO en que el usuario se puso una
    // meta de lectura, si la cumplió o no. Si cumplió al menos un año,
    // desbloquea "yllqmdlg"; si no cumplió al menos un año, desbloquea
    // "dlml" (un usuario podría tener ambas, de años distintos).
    const metasCumplimiento = () => new Promise((resolve) => {
        const anioActual = new Date().getFullYear();
        db.all(
            `SELECT anio, meta FROM metas_lectura WHERE user_id = ? AND anio < ?`,
            [userId, anioActual],
            (err, metas) => {
                if (err || !metas || metas.length === 0) return resolve({ cumplida: false, noCumplida: false });

                let pendientes = metas.length;
                let cumplida = false;
                let noCumplida = false;
                metas.forEach(m => {
                    db.get(
                        `SELECT COUNT(*) AS n
                         FROM shelf_items
                         JOIN shelves ON shelves.id = shelf_items.shelf_id
                         WHERE shelves.user_id = ?
                           AND LOWER(shelves.nombre) = LOWER('Terminado')
                           AND EXTRACT(YEAR FROM shelf_items.created_at) = ?`,
                        [userId, m.anio],
                        (err, row) => {
                            const leidos = err ? 0 : row.n;
                            if (leidos >= m.meta) cumplida = true; else noCumplida = true;
                            pendientes--;
                            if (pendientes === 0) resolve({ cumplida, noCumplida });
                        }
                    );
                });
            }
        );
    });

    // Suma comentarios en posts + reseñas + libros (3 tablas separadas)
    const contarComentariosTotales = () => Promise.all([
        contar(`SELECT COUNT(*) AS n FROM comments WHERE user_id = ?`, [userId]),
        contar(`SELECT COUNT(*) AS n FROM review_comments WHERE user_id = ?`, [userId]),
        contar(`SELECT COUNT(*) AS n FROM book_comments WHERE user_id = ?`, [userId])
    ]).then(([a, b, c]) => a + b + c);

    // ¿La cuenta tiene más de un año de antigüedad?
    const tieneUnAnioDeAntiguedad = () => new Promise((resolve) => {
        db.get(`SELECT created_at FROM users WHERE id = ?`, [userId], (err, row) => {
            if (err || !row || !row.created_at) return resolve(false);
            const creado = new Date(row.created_at);
            const unAnioMs = 365 * 24 * 60 * 60 * 1000;
            resolve((Date.now() - creado.getTime()) >= unAnioMs);
        });
    });

    const contarEnEstanteria = (nombreEstanteria) => contar(
        `SELECT COUNT(*) AS n FROM shelf_items JOIN shelves ON shelves.id = shelf_items.shelf_id
         WHERE shelves.user_id = ? AND LOWER(shelves.nombre) = LOWER(?)`,
        [userId, nombreEstanteria]
    );

    return Promise.all([
        contar(`SELECT COUNT(*) AS n FROM posts WHERE user_id = ?`, [userId]),
        contar(`SELECT COUNT(*) AS n FROM reviews WHERE user_id = ?`, [userId]),
        contar(`SELECT COUNT(*) AS n FROM reviews WHERE user_id = ? AND valoracion = 5`, [userId]),
        contar(
            `SELECT COUNT(*) AS n FROM friend_requests WHERE (from_user_id = ? OR to_user_id = ?) AND estado = 'aceptada'`,
            [userId, userId]
        ),
        contar(`SELECT COUNT(*) AS n FROM follows WHERE followed_id = ?`, [userId]),
        contar(`SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?`, [userId]),
        contar(
            `SELECT COUNT(*) AS n FROM shelf_items JOIN shelves ON shelves.id = shelf_items.shelf_id WHERE shelves.user_id = ?`,
            [userId]
        ),
        contarEnEstanteria('Quiero Leer'),
        contarEnEstanteria('Terminado'),
        contarEnEstanteria('DNF'),
        contar(`SELECT COUNT(*) AS n FROM shelves WHERE user_id = ?`, [userId]),
        contar(`SELECT COUNT(*) AS n FROM lecturas_en_curso WHERE user_id = ?`, [userId]),
        contar(`SELECT COUNT(*) AS n FROM questions WHERE asker_id = ?`, [userId]),
        contar(`SELECT COUNT(*) AS n FROM questions WHERE asked_id = ?`, [userId]),
        contarComentariosTotales(),
        contar(`SELECT COUNT(*) AS n FROM likes WHERE user_id = ?`, [userId]),
        contar(`SELECT COUNT(*) AS n FROM messages WHERE sender_id = ?`, [userId]),
        tieneUnAnioDeAntiguedad(),
        metasCumplimiento()
    ]).then(([
        posts, reviews, reviews5estrellas, amigos, seguidores, seguidos, librosEnEstantes,
        quieroLeer, terminados, dnf, estanteriasCreadas, lecturasIniciadas,
        preguntasHechas, preguntasRecibidas, comentariosTotales, likesDados,
        mensajesEnviados, antiguo, metas
    ]) => ([
        { nombre: 'Primera Publicación', icono: '📣', desbloqueada: posts >= 1, descripcion: 'Publica tu primer post' },
        { nombre: 'Publicador Activo', icono: '📢', desbloqueada: posts >= 10, descripcion: 'Publica 10 posts' },
        { nombre: 'Voz Incansable', icono: '🔊', desbloqueada: posts >= 50, descripcion: 'Publica 50 posts' },
        { nombre: 'Primera Reseña', icono: '📝', desbloqueada: reviews >= 1, descripcion: 'Publica tu primera reseña' },
        { nombre: 'Crítico Literario', icono: '🖋️', desbloqueada: reviews >= 5, descripcion: 'Publica 5 reseñas' },
        { nombre: 'Crítico de Élite', icono: '🎖️', desbloqueada: reviews >= 20, descripcion: 'Publica 20 reseñas' },
        { nombre: 'Cinco Estrellas', icono: '🌟', desbloqueada: reviews5estrellas >= 1, descripcion: 'Dale 5 estrellas a un libro en una reseña' },
        { nombre: 'Primer Amigo', icono: '🤝', desbloqueada: amigos >= 1, descripcion: 'Agrega tu primer amigo' },
        { nombre: 'Sociable', icono: '👥', desbloqueada: amigos >= 5, descripcion: 'Ten 5 amigos' },
        { nombre: 'Círculo Cercano', icono: '💞', desbloqueada: amigos >= 15, descripcion: 'Ten 15 amigos' },
        { nombre: 'Popular', icono: '📈', desbloqueada: seguidores >= 10, descripcion: 'Consigue 10 seguidores' },
        { nombre: 'Estrella de NAVYBLUE', icono: '🌠', desbloqueada: seguidores >= 50, descripcion: 'Consigue 50 seguidores' },
        { nombre: 'Siguiendo la Pista', icono: '🧭', desbloqueada: seguidos >= 10, descripcion: 'Sigue a 10 personas' },
        { nombre: 'Lector', icono: '📖', desbloqueada: librosEnEstantes >= 1, descripcion: 'Agrega un libro a una estantería' },
        { nombre: 'Coleccionista', icono: '📚', desbloqueada: librosEnEstantes >= 25, descripcion: 'Ten 25 libros en tus estanterías' },
        { nombre: 'Bibliotecario', icono: '🏛️', desbloqueada: librosEnEstantes >= 100, descripcion: 'Ten 100 libros en tus estanterías' },
        { nombre: 'Wishlist Infinita', icono: '🎁', desbloqueada: quieroLeer >= 10, descripcion: 'Ten 10 libros en "Quiero Leer"' },
        { nombre: 'Terminador', icono: '✅', desbloqueada: terminados >= 10, descripcion: 'Ten 10 libros en "Terminado"' },
        { nombre: 'Primeras Páginas', icono: '📄', desbloqueada: lecturasIniciadas >= 1, descripcion: 'Empieza a leer un libro (Leyendo ahora)' },
        { nombre: 'Se Aprende Soltando', icono: '🏳️', desbloqueada: dnf >= 1, descripcion: 'Marca un libro como DNF' },
        { nombre: 'Organizador', icono: '🗂️', desbloqueada: estanteriasCreadas >= 5, descripcion: 'Crea 5 estanterías propias' },
        { nombre: 'yllqmdlg', icono: '🏆', desbloqueada: metas.cumplida, descripcion: 'Cumple tu meta de libros de un año' },
        { nombre: 'dlml', icono: '💔', desbloqueada: metas.noCumplida, descripcion: 'No cumplas tu meta de libros de un año' },
        { nombre: 'Rompehielos', icono: '🧊', desbloqueada: preguntasHechas >= 1, descripcion: 'Hazle una pregunta pública a alguien' },
        { nombre: 'Preguntón', icono: '❓', desbloqueada: preguntasHechas >= 10, descripcion: 'Haz 10 preguntas públicas' },
        { nombre: 'El Oráculo', icono: '🔮', desbloqueada: preguntasRecibidas >= 10, descripcion: 'Recibe 10 preguntas públicas' },
        { nombre: 'Comentarista', icono: '💬', desbloqueada: comentariosTotales >= 1, descripcion: 'Deja tu primer comentario' },
        { nombre: 'Aplaudidor', icono: '👏', desbloqueada: likesDados >= 10, descripcion: 'Dale like a 10 publicaciones' },
        { nombre: 'Mensajero', icono: '✉️', desbloqueada: mensajesEnviados >= 1, descripcion: 'Envía tu primer mensaje privado' },
        { nombre: 'Un Año Aquí', icono: '🎂', desbloqueada: antiguo, descripcion: 'Ten tu cuenta creada hace más de un año' }
    ]));
}

// Estadísticas globales: cuántas personas (de cuántas registradas en total)
// tienen desbloqueada cada insignia. Se recalcula recorriendo a todos los
// usuarios, así que se cachea un minuto para no repetir el trabajo en cada
// visita a un muro o a la página de insignias.
let _cacheBadgeStats = null;
let _cacheBadgeStatsTs = 0;
const CACHE_BADGE_STATS_MS = 60 * 1000;

function calcularEstadisticasBadges() {
    if (_cacheBadgeStats && (Date.now() - _cacheBadgeStatsTs) < CACHE_BADGE_STATS_MS) {
        return Promise.resolve(_cacheBadgeStats);
    }
    return new Promise((resolve, reject) => {
        db.all(`SELECT id FROM users`, [], (err, users) => {
            if (err) return reject(err);
            const total = users.length;
            if (total === 0) {
                const vacio = { total: 0, conteos: {} };
                _cacheBadgeStats = vacio;
                _cacheBadgeStatsTs = Date.now();
                return resolve(vacio);
            }
            Promise.all(users.map(u => calcularBadgesUsuario(u.id)))
                .then((todasLasBadges) => {
                    const conteos = {};
                    todasLasBadges.forEach(badges => {
                        badges.forEach(b => {
                            if (b.desbloqueada) conteos[b.nombre] = (conteos[b.nombre] || 0) + 1;
                        });
                    });
                    const stats = { total, conteos };
                    _cacheBadgeStats = stats;
                    _cacheBadgeStatsTs = Date.now();
                    resolve(stats);
                })
                .catch(reject);
        });
    });
}

app.get('/api/users/:username/badges', (req, res) => {
    const { username } = req.params;

    db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, user) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

        Promise.all([calcularBadgesUsuario(user.id), calcularEstadisticasBadges()])
            .then(([badges, stats]) => {
                const badgesConPorcentaje = badges.map(b => {
                    const personas = stats.conteos[b.nombre] || 0;
                    const porcentaje = stats.total > 0 ? Math.round((personas / stats.total) * 100) : 0;
                    return { ...b, porcentaje, personas, total_usuarios: stats.total };
                });
                res.json({ badges: badgesConPorcentaje });
            })
            .catch(() => res.status(500).json({ error: 'Error en el servidor' }));
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

// --- RUTAS DE PREGUNTAS (públicas, 1 por día de cada usuario hacia cada otro) ---

const LARGO_MAX_PREGUNTA = 200;

// Feed general de preguntas (todas), o las hechas a un usuario puntual (?username=)
app.get('/api/questions', (req, res) => {
    const { username } = req.query;

    if (username) {
        db.all(
            `SELECT id, asker_username, asked_username, content, created_at
             FROM questions WHERE asked_username = ? ORDER BY id DESC`,
            [username],
            (err, rows) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ questions: rows });
            }
        );
    } else {
        db.all(
            `SELECT id, asker_username, asked_username, content, created_at FROM questions ORDER BY id DESC`,
            [],
            (err, rows) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ questions: rows });
            }
        );
    }
});

// Si hoy ya le hice una pregunta a esta persona (para deshabilitar el botón en el frontend)
app.get('/api/questions/:username/estado', requiereSesion, (req, res) => {
    const miId = req.session.user.id;
    const { username } = req.params;

    db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, otro) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!otro) return res.status(404).json({ error: 'Usuario no encontrado' });

        db.get(
            `SELECT id FROM questions WHERE asker_id = ? AND asked_id = ? AND created_at::date = CURRENT_DATE`,
            [miId, otro.id],
            (err, preguntaHoy) => {
                if (err) return res.status(500).json({ error: 'Error en el servidor' });
                res.json({ yaPreguntoHoy: !!preguntaHoy });
            }
        );
    });
});

// Hacer una pregunta pública a alguien: máx. 200 caracteres, 1 por día por persona
app.post('/api/questions/:username', requiereSesion, (req, res) => {
    const miId = req.session.user.id;
    const miUsername = req.session.user.username;
    const { username } = req.params;
    const { content } = req.body;

    if (username === miUsername) {
        return res.status(400).json({ error: 'No puedes hacerte una pregunta a ti mismo' });
    }
    if (!content || !content.trim()) {
        return res.status(400).json({ error: 'La pregunta no puede estar vacía' });
    }
    if (content.trim().length > LARGO_MAX_PREGUNTA) {
        return res.status(400).json({ error: `La pregunta no puede superar los ${LARGO_MAX_PREGUNTA} caracteres` });
    }

    db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, otro) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!otro) return res.status(404).json({ error: 'Usuario no encontrado' });

        db.get(
            `SELECT id FROM questions WHERE asker_id = ? AND asked_id = ? AND created_at::date = CURRENT_DATE`,
            [miId, otro.id],
            (err, preguntaHoy) => {
                if (err) return res.status(500).json({ error: 'Error en el servidor' });
                if (preguntaHoy) return res.status(429).json({ error: 'Ya le hiciste una pregunta hoy a esta persona. Podrás preguntarle de nuevo mañana.' });

                db.run(
                    `INSERT INTO questions (asker_id, asker_username, asked_id, asked_username, content) VALUES (?, ?, ?, ?, ?)`,
                    [miId, miUsername, otro.id, username, content.trim()],
                    function(err) {
                        if (err) return res.status(500).json({ error: 'Error en el servidor' });
                        crearNotificacion(otro.id, miUsername, `${miUsername} te hizo una pregunta`);
                        res.status(201).json({ message: 'Pregunta enviada', questionId: this.lastID });
                    }
                );
            }
        );
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

            const porDefecto = ['Leyendo', 'Quiero Leer', 'Terminado', 'DNF'];
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

// Renombrar una estantería propia
app.put('/api/shelves/:id', requiereSesion, (req, res) => {
    const { id } = req.params;
    const { nombre } = req.body;
    if (!nombre || !nombre.trim()) {
        return res.status(400).json({ error: 'La estantería necesita un nombre' });
    }
    db.get(`SELECT user_id FROM shelves WHERE id = ?`, [id], (err, estante) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!estante) return res.status(404).json({ error: 'Estantería no encontrada' });
        if (estante.user_id !== req.session.user.id) {
            return res.status(403).json({ error: 'No puedes modificar estanterías de otros usuarios' });
        }
        db.run(`UPDATE shelves SET nombre = ? WHERE id = ?`, [nombre.trim(), id], (err) => {
            if (err) return res.status(500).json({ error: 'Error en el servidor' });
            res.json({ message: 'Estantería actualizada' });
        });
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

// Modificar un libro de una estantería propia (título, autor y/o portada)
app.put('/api/shelf-items/:id', requiereSesion, (req, res) => {
    const { id } = req.params;
    const { libro_titulo, autor, portada_url } = req.body;

    if (!libro_titulo || !autor) {
        return res.status(400).json({ error: 'Completa al menos título y autor' });
    }

    db.get(
        `SELECT shelves.user_id FROM shelf_items JOIN shelves ON shelves.id = shelf_items.shelf_id WHERE shelf_items.id = ?`,
        [id],
        (err, fila) => {
            if (err) return res.status(500).json({ error: 'Error en el servidor' });
            if (!fila) return res.status(404).json({ error: 'Libro no encontrado' });
            if (fila.user_id !== req.session.user.id) {
                return res.status(403).json({ error: 'No puedes modificar estanterías de otros usuarios' });
            }
            db.run(
                `UPDATE shelf_items SET libro_titulo = ?, autor = ?, portada_url = ? WHERE id = ?`,
                [libro_titulo, autor, portada_url || null, id],
                (err) => {
                    if (err) return res.status(500).json({ error: 'Error en el servidor' });
                    res.json({ message: 'Libro actualizado' });
                }
            );
        }
    );
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

// --- INTEGRACIÓN CON OPEN LIBRARY ---
// API pública y 100% gratuita de libros (sin API key, sin límites agresivos):
// https://openlibrary.org/developers/api
// Se usa en todo el sitio donde se necesitan datos reales de libros: la
// pestaña "Libros" del buscador, y el autocompletado al agregar libros a una
// estantería, empezar una lectura o publicar una reseña.

// Arma la URL de la portada a partir del cover_i que devuelve Open Library.
function portadaOpenLibrary(coverId) {
    return coverId ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg` : null;
}

async function buscarEnOpenLibrary(q, limite = 8) {
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=${limite}&fields=title,author_name,cover_i,first_publish_year,number_of_pages_median,publisher`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'NavyBlue (proyecto personal)' } });
    if (!resp.ok) throw new Error(`Open Library respondió ${resp.status}`);
    const data = await resp.json();
    return (data.docs || []).map(doc => ({
        titulo: doc.title,
        autor: (doc.author_name && doc.author_name[0]) || 'Autor desconocido',
        editorial: (doc.publisher && doc.publisher[0]) || null,
        portada_url: portadaOpenLibrary(doc.cover_i),
        anio: doc.first_publish_year || null,
        paginas: doc.number_of_pages_median || null
    }));
}

// Ruta que usan los formularios (estanterías, lecturas, reseñas) para
// autocompletar título/autor/portada mientras la persona escribe.
app.get('/api/libros/buscar', async (req, res) => {
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

// Mapa de códigos de idioma de Open Library (ISO 639-2) a nombres en español
const NOMBRES_IDIOMA = {
    eng: 'Inglés', spa: 'Español', fre: 'Francés', fra: 'Francés', ger: 'Alemán',
    ita: 'Italiano', por: 'Portugués', jpn: 'Japonés', chi: 'Chino', kor: 'Coreano'
};

// Trae datos "de ficha" de un libro puntual (editorial, idioma, páginas,
// categoría, ISBN y sinopsis) buscándolo por título + autor en Open Library.
// Es "best effort": si el libro no aparece o Open Library falla, se devuelve
// null y la página de detalle simplemente no muestra esos campos.
async function buscarDetalleEnOpenLibrary(titulo, autor) {
    const q = autor ? `${titulo} ${autor}` : titulo;
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=1&fields=key,title,author_name,cover_i,first_publish_year,number_of_pages_median,publisher,language,isbn,subject`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'NavyBlue (proyecto personal)' } });
    if (!resp.ok) throw new Error(`Open Library respondió ${resp.status}`);
    const data = await resp.json();
    const doc = (data.docs || [])[0];
    if (!doc) return null;

    // La sinopsis vive en la ficha de la "obra" (work), un segundo llamado
    // usando la key que devuelve la búsqueda (ej: "/works/OL12345W")
    let sinopsis = null;
    if (doc.key) {
        try {
            const respObra = await fetch(`https://openlibrary.org${doc.key}.json`, { headers: { 'User-Agent': 'NavyBlue (proyecto personal)' } });
            if (respObra.ok) {
                const obra = await respObra.json();
                if (obra.description) {
                    sinopsis = typeof obra.description === 'string' ? obra.description : obra.description.value;
                }
            }
        } catch (error) {
            // sin sinopsis, no es grave
        }
    }

    return {
        editorial: (doc.publisher && doc.publisher[0]) || null,
        idioma: (doc.language && (NOMBRES_IDIOMA[doc.language[0]] || doc.language[0])) || null,
        paginas: doc.number_of_pages_median || null,
        categoria: (doc.subject && doc.subject.slice(0, 3).join(', ')) || null,
        isbn: (doc.isbn && doc.isbn[0]) || null,
        anio: doc.first_publish_year || null,
        sinopsis
    };
}

// --- PÁGINA DE DETALLE DE UN LIBRO (libro.html) ---
// Se abre al pinchar el título de un libro en cualquier parte del sitio
// (reseñas, estanterías, leyendo ahora). Junta: ficha del libro (Open
// Library, best-effort), la valoración promedio calculada con las reseñas
// que existen en NAVYBLUE, y permite comentar el libro como si fuera un post.

app.get('/api/libros/detalle', async (req, res) => {
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
app.get('/api/libros/comments', (req, res) => {
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

app.post('/api/libros/comments', requiereSesion, (req, res) => {
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

app.delete('/api/libros/comments/:id', requiereSesion, (req, res) => {
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

// --- RUTA DE BÚSQUEDA ---

app.get('/api/search', (req, res) => {
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

// --- RUTAS DE RESEÑAS (funcionalidad separada de los posts) ---

// Listar reseñas recientes, con sus contadores y tu propia reacción si tienes sesión
app.get('/api/reviews', (req, res) => {
    const miId = req.session.user ? req.session.user.id : null;
    const { username } = req.query;

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
app.get('/api/reviews/top', (req, res) => {
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
app.get('/api/reviews/:id', (req, res) => {
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
app.post('/api/reviews', requiereSesion, (req, res) => {
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
            db.run(`DELETE FROM review_comments WHERE review_id = ?`, [id]);
            res.json({ message: 'Reseña eliminada con éxito' });
        });
    });
});

// --- COMENTARIOS EN RESEÑAS ---

app.get('/api/reviews/:id/comments', (req, res) => {
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

app.post('/api/reviews/:id/comments', requiereSesion, (req, res) => {
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
                if (review) crearNotificacion(review.user_id, req.session.user.username, `${req.session.user.username} comentó tu reseña`);
            });
            notificarMenciones(content.trim(), req.session.user.username, 'un comentario de reseña');
            res.status(201).json({ message: 'Comentario agregado', commentId: this.lastID });
        }
    );
});

app.delete('/api/review-comments/:id', requiereSesion, (req, res) => {
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

app.get('/api/trending/:tag/posts', (req, res) => {
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