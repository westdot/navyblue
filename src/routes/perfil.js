const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db/compat');
const requiereSesion = require('../middleware/auth');

const router = express.Router();

// --- RUTAS DE PERFIL ---

// Perfil PÚBLICO de cualquier usuario (nombre, país, fecha de registro) — para
// poder mostrar el muro de otras personas, sin exponer correo ni datos privados
router.get('/users/:username', (req, res) => {
    db.get(`SELECT name, username, pais, created_at, foto_url, fondo_url, fondo_color FROM users WHERE username = ?`, [req.params.username], (err, user) => {
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
router.put('/profile/foto', requiereSesion, (req, res) => {
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
router.put('/profile/fondo', requiereSesion, (req, res) => {
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

// Colores pasteles disponibles para el fondo del muro (cuando no hay foto de
// portada). Se valida contra esta misma lista en el servidor para no guardar
// cualquier string como color. El degradado real de cada uno vive en el
// frontend (muro.html); acá solo nos importa que la clave sea válida.
const COLORES_FONDO_VALIDOS = [
    'navy', 'dorado', 'salvia', 'terracota', 'lavanda', 'ciruela',
    'arena', 'bosque', 'cielo', 'rosa', 'musgo', 'vino'
];
router.put('/profile/color-fondo', requiereSesion, (req, res) => {
    const { color } = req.body;
    const { id: userId } = req.session.user;

    if (!COLORES_FONDO_VALIDOS.includes(color)) {
        return res.status(400).json({ error: 'Ese color no es válido.' });
    }

    db.run(`UPDATE users SET fondo_color = ? WHERE id = ?`, [color, userId], (err) => {
        if (err) return res.status(500).json({ error: 'No se pudo guardar el color.' });
        res.json({ message: 'Color de fondo actualizado', color });
    });
});

// Obtener los datos del perfil propio
router.get('/profile', requiereSesion, (req, res) => {
    const { username } = req.session.user;
    db.get(`SELECT id, name, username, email, pais, created_at FROM users WHERE username = ?`, [username], (err, user) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
        res.json({ user });
    });
});

// Actualizar nombre / usuario / correo
router.put('/profile', requiereSesion, (req, res) => {
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
router.put('/profile/password', requiereSesion, async (req, res) => {
    const { username } = req.session.user;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Faltan datos obligatorios' });
    }
    if (newPassword.length < 8) {
        return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' });
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

module.exports = router;
