const express = require('express');
const db = require('../db/compat');
const requiereSesion = require('../middleware/auth');
const { leerPaginacion, recortarPagina } = require('../utils/paginacion');

const router = express.Router();

// --- RUTAS DE NOTIFICACIONES ---

// Notificaciones propias, de a páginas (scroll infinito dentro del panel):
// ?limit=20&before=<id>. Además del listado devuelve cuántas no leídas hay en total.
router.get('/notifications', requiereSesion, (req, res) => {
    const userId = req.session.user.id;
    const { limit, before } = leerPaginacion(req.query);

    const params = [userId];
    let where = 'WHERE user_id = ?';
    if (before) { where += ' AND id < ?'; params.push(before); }
    params.push(limit + 1);

    db.all(
        `SELECT id, actor_username, mensaje, destino, leida, created_at FROM notifications ${where} ORDER BY id DESC LIMIT ?`,
        params,
        (err, rows) => {
            if (err) return res.status(500).json({ error: 'Error en el servidor' });
            const { filas, hasMore } = recortarPagina(rows, limit);
            db.get(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND leida = 0`, [userId], (err, row) => {
                if (err) return res.status(500).json({ error: 'Error en el servidor' });
                res.json({ notifications: filas, noLeidas: row.n, hasMore });
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
