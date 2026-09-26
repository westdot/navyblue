const express = require('express');
const db = require('../db/compat');
const requiereSesion = require('../middleware/auth');

const router = express.Router();

// --- RUTAS DE NOTIFICACIONES ---

// Últimas notificaciones propias + cuántas no leídas
router.get('/notifications', requiereSesion, (req, res) => {
    const userId = req.session.user.id;
    db.all(
        `SELECT id, actor_username, mensaje, destino, leida, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 20`,
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
router.post('/notifications/marcar-leidas', requiereSesion, (req, res) => {
    db.run(`UPDATE notifications SET leida = 1 WHERE user_id = ? AND leida = 0`, [req.session.user.id], (err) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        res.json({ message: 'Notificaciones marcadas como leídas' });
    });
});

module.exports = router;
