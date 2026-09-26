const db = require('../db/compat');

// Crea una notificación para userId, salvo que sea la misma persona que hizo la
// acción (no tiene sentido notificarte a ti mismo por darte like a tu propio post).
// `destino` es la página a la que debe llevar al hacer click (ej.
// "mensajes.html?usuario=x"); si se omite, el frontend usa el muro del actor.
function crearNotificacion(userId, actorUsername, mensaje, destino = null) {
    if (!userId) return;
    db.get(`SELECT username FROM users WHERE id = ?`, [userId], (err, destinatario) => {
        if (err || !destinatario) return;
        if (destinatario.username === actorUsername) return; // no te notifiques a ti mismo
        db.run(
            `INSERT INTO notifications (user_id, actor_username, mensaje, destino) VALUES (?, ?, ?, ?)`,
            [userId, actorUsername, mensaje, destino]
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

module.exports = { crearNotificacion, notificarMenciones };
