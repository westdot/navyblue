const express = require('express');

const router = express.Router();

router.use(require('./auth'));
router.use(require('./posts'));
router.use(require('./comentarios'));
router.use(require('./interacciones'));
router.use(require('./perfil'));
router.use(require('./seguir'));
router.use(require('./amigos'));
router.use(require('./mensajes'));
router.use(require('./lecturas'));
router.use(require('./metaLectura'));
router.use(require('./insignias'));
router.use(require('./notificaciones'));
router.use(require('./preguntas'));
router.use(require('./estanterias'));
router.use(require('./libros'));
router.use(require('./busqueda'));
router.use(require('./resenas'));
router.use(require('./trending'));
router.use(require('./catalogo'));

module.exports = router;
