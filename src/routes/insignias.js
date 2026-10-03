const express = require('express');
const db = require('../db/compat');

const router = express.Router();

// --- RUTA DE INSIGNIAS / LOGROS ---
// Se calculan al vuelo según tu actividad real (no se guardan aparte, así
// siempre reflejan el estado actual sin desincronizarse).
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
        { nombre: 'Primera Publicación', icono: '📣', desbloqueada: posts >= 1, actual: posts, requisito: 1, descripcion: 'Publica tu primer post' },
        { nombre: 'Publicador Activo', icono: '📢', desbloqueada: posts >= 10, actual: posts, requisito: 10, descripcion: 'Publica 10 posts' },
        { nombre: 'Voz Incansable', icono: '🔊', desbloqueada: posts >= 50, actual: posts, requisito: 50, descripcion: 'Publica 50 posts' },
        { nombre: 'Primera Reseña', icono: '📝', desbloqueada: reviews >= 1, actual: reviews, requisito: 1, descripcion: 'Publica tu primera reseña' },
        { nombre: 'Crítico Literario', icono: '🖋️', desbloqueada: reviews >= 5, actual: reviews, requisito: 5, descripcion: 'Publica 5 reseñas' },
        { nombre: 'Crítico de Élite', icono: '🎖️', desbloqueada: reviews >= 20, actual: reviews, requisito: 20, descripcion: 'Publica 20 reseñas' },
        { nombre: 'Cinco Estrellas', icono: '🌟', desbloqueada: reviews5estrellas >= 1, actual: reviews5estrellas, requisito: 1, descripcion: 'Dale 5 estrellas a un libro en una reseña' },
        { nombre: 'Primer Amigo', icono: '🤝', desbloqueada: amigos >= 1, actual: amigos, requisito: 1, descripcion: 'Agrega tu primer amigo' },
        { nombre: 'Sociable', icono: '👥', desbloqueada: amigos >= 5, actual: amigos, requisito: 5, descripcion: 'Ten 5 amigos' },
        { nombre: 'Círculo Cercano', icono: '💞', desbloqueada: amigos >= 15, actual: amigos, requisito: 15, descripcion: 'Ten 15 amigos' },
        { nombre: 'Popular', icono: '📈', desbloqueada: seguidores >= 10, actual: seguidores, requisito: 10, descripcion: 'Consigue 10 seguidores' },
        { nombre: 'Estrella de NAVYBLUE', icono: '🌠', desbloqueada: seguidores >= 50, actual: seguidores, requisito: 50, descripcion: 'Consigue 50 seguidores' },
        { nombre: 'Siguiendo la Pista', icono: '🧭', desbloqueada: seguidos >= 10, actual: seguidos, requisito: 10, descripcion: 'Sigue a 10 personas' },
        { nombre: 'Lector', icono: '📖', desbloqueada: librosEnEstantes >= 1, actual: librosEnEstantes, requisito: 1, descripcion: 'Agrega un libro a una estantería' },
        { nombre: 'Coleccionista', icono: '📚', desbloqueada: librosEnEstantes >= 25, actual: librosEnEstantes, requisito: 25, descripcion: 'Ten 25 libros en tus estanterías' },
        { nombre: 'Bibliotecario', icono: '🏛️', desbloqueada: librosEnEstantes >= 100, actual: librosEnEstantes, requisito: 100, descripcion: 'Ten 100 libros en tus estanterías' },
        { nombre: 'Wishlist Infinita', icono: '🎁', desbloqueada: quieroLeer >= 10, actual: quieroLeer, requisito: 10, descripcion: 'Ten 10 libros en "Quiero Leer"' },
        { nombre: 'Terminador', icono: '✅', desbloqueada: terminados >= 10, actual: terminados, requisito: 10, descripcion: 'Ten 10 libros en "Terminado"' },
        { nombre: 'Primeras Páginas', icono: '📄', desbloqueada: lecturasIniciadas >= 1, actual: lecturasIniciadas, requisito: 1, descripcion: 'Empieza a leer un libro (Leyendo ahora)' },
        { nombre: 'Se Aprende Soltando', icono: '🏳️', desbloqueada: dnf >= 1, actual: dnf, requisito: 1, descripcion: 'Marca un libro como DNF' },
        { nombre: 'Organizador', icono: '🗂️', desbloqueada: estanteriasCreadas >= 5, actual: estanteriasCreadas, requisito: 5, descripcion: 'Crea 5 estanterías propias' },
        { nombre: 'yllqmdlg', icono: '🏆', desbloqueada: metas.cumplida, descripcion: 'Cumple tu meta de libros de un año' },
        { nombre: 'dlml', icono: '💔', desbloqueada: metas.noCumplida, descripcion: 'No cumplas tu meta de libros de un año' },
        { nombre: 'Rompehielos', icono: '🧊', desbloqueada: preguntasHechas >= 1, actual: preguntasHechas, requisito: 1, descripcion: 'Hazle una pregunta pública a alguien' },
        { nombre: 'Preguntón', icono: '❓', desbloqueada: preguntasHechas >= 10, actual: preguntasHechas, requisito: 10, descripcion: 'Haz 10 preguntas públicas' },
        { nombre: 'El Oráculo', icono: '🔮', desbloqueada: preguntasRecibidas >= 10, actual: preguntasRecibidas, requisito: 10, descripcion: 'Recibe 10 preguntas públicas' },
        { nombre: 'Comentarista', icono: '💬', desbloqueada: comentariosTotales >= 1, actual: comentariosTotales, requisito: 1, descripcion: 'Deja tu primer comentario' },
        { nombre: 'Aplaudidor', icono: '👏', desbloqueada: likesDados >= 10, actual: likesDados, requisito: 10, descripcion: 'Dale like a 10 publicaciones' },
        { nombre: 'Mensajero', icono: '✉️', desbloqueada: mensajesEnviados >= 1, actual: mensajesEnviados, requisito: 1, descripcion: 'Envía tu primer mensaje privado' },
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

router.get('/users/:username/badges', (req, res) => {
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

module.exports = router;
