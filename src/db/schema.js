const { pool } = require('./pool');

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
        // color de fondo del muro (pastel, a elección), para cuando no hay foto de portada
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS fondo_color TEXT`);

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
        // A qué página debe llevar al hacer click (ej. "mensajes.html?usuario=x",
        // "post.html?id=5"). Si es NULL (notificaciones viejas, de antes de este
        // cambio), el frontend cae de vuelta al muro del actor como antes.
        await pool.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS destino TEXT`);

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
        // Respuesta pública a la pregunta (una sola por pregunta: solo se puede
        // responder mientras esté en NULL). La persona que la puede responder es
        // siempre asked_id, nunca el que preguntó.
        await pool.query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS respuesta TEXT`);
        await pool.query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS respondida_at TIMESTAMP`);

        // --- ÍNDICES ---
        // Sin esto, cada consulta que filtra por una de estas columnas (ej. "dame
        // los posts de este usuario", "las notificaciones de este usuario") obliga
        // a Postgres a revisar la tabla entera fila por fila. Con la cantidad de
        // datos de hoy no se nota, pero es la primera causa de que un sitio se
        // ponga lento apenas crece. No se listan las columnas que ya tienen un
        // índice automático por venir de un UNIQUE (ej. username, email, o el
        // "post_id" de likes/reposts que ya es la primera columna de su UNIQUE).
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_comments_user_id ON comments(user_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_likes_user_id ON likes(user_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_reposts_user_id ON reposts(user_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_reviews_user_id ON reviews(user_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_reviews_created_at ON reviews(created_at DESC)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_review_comments_review_id ON review_comments(review_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_follows_followed_id ON follows(followed_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_friend_requests_to_user_id ON friend_requests(to_user_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_shelves_user_id ON shelves(user_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_shelf_items_shelf_id ON shelf_items(shelf_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_lecturas_user_id ON lecturas_en_curso(user_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_book_comments_libro ON book_comments(libro_titulo, autor)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_receiver_id ON messages(receiver_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_questions_asked_id ON questions(asked_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_questions_asker_id ON questions(asker_id)`);

        // Backfill: a cualquier cuenta ya existente que todavía no tenga una
        // estantería "Leídos" (o "Terminado", por si alguien ya usaba ese nombre)
        // se la creamos, para que la meta de lectura tenga algo que contar.
        await pool.query(`
            INSERT INTO shelves (user_id, nombre)
            SELECT id, 'Leídos' FROM users
            WHERE id NOT IN (
                SELECT user_id FROM shelves WHERE LOWER(nombre) IN ('leídos', 'leidos', 'terminado', 'terminados')
            )
        `);

        console.log('Tablas verificadas/creadas correctamente en PostgreSQL.');
    } catch (err) {
        console.error('Error creando las tablas:', err.message);
    }
}

module.exports = crearTablas;
