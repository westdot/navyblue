// Middleware simple: exige que haya sesión activa
function requiereSesion(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Debes iniciar sesión' });
    }
    next();
}

module.exports = requiereSesion;
