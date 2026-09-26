const db = require('../db/compat');

// Chequea si dos cuentas son amigos (amistad aceptada, en cualquier dirección).
// Se usa para restringir los mensajes privados a solo amigos.
function sonAmigos(idA, idB, callback) {
    db.get(
        `SELECT id FROM friend_requests WHERE estado = 'aceptada' AND ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))`,
        [idA, idB, idB, idA],
        (err, row) => callback(err, !!row)
    );
}

module.exports = { sonAmigos };
