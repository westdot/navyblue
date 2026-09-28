const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db/compat');
const { loginLimiter, registerLimiter } = require('../middleware/rateLimiters');

const router = express.Router();

// --- RUTAS DE AUTENTICACIÓN ---

// Registro de usuario
router.post('/register', registerLimiter, async (req, res) => {
    const { name, username, email, password, pais } = req.body;
    
    if (!name || !username || !email || !password) {
        return res.status(400).json({ error: 'Faltan datos obligatorios' });
    }
    if (password.length < 8) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
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

// Inicio de sesión actualizado
router.post('/login', loginLimiter, (req, res) => {
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
router.get('/session', (req, res) => {
    if (req.session.user) {
        res.json({ loggedIn: true, user: req.session.user });
    } else {
        res.json({ loggedIn: false });
    }
});

// Cerrar sesión
router.post('/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ message: 'Sesión cerrada' });
    });
});

module.exports = router;
