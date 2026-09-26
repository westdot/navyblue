const rateLimit = require('express-rate-limit');

// Freno para login/registro: sin esto, cualquiera puede probar contraseñas
// a la fuerza (o crear cuentas en cadena) sin límite. Se cuenta por IP.
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 10, // 10 intentos de login por IP en esa ventana
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos de inicio de sesión. Espera unos minutos y vuelve a intentar.' }
});
const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hora
    max: 20, // 20 registros por IP por hora (deja margen para redes/oficinas compartidas)
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas cuentas creadas desde esta conexión. Intenta de nuevo más tarde.' }
});

module.exports = { loginLimiter, registerLimiter };
