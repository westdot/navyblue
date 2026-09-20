// ui-comunes.js
// Utilidades de interfaz compartidas por todas las páginas:
//  - confirmarAccion(mensaje): reemplaza confirm() del navegador por un diálogo propio
//  - mostrarAviso(mensaje): reemplaza alert() del navegador por un diálogo propio
//  - crearEstadoVacio(mensaje): un bloque con un ícono simple + texto, para listas vacías

function _crearOverlayDialogo() {
    let overlay = document.getElementById('dialogo-overlay-comun');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'dialogo-overlay-comun';
    overlay.className = 'dialogo-overlay';
    overlay.innerHTML = `
        <div class="dialogo-caja">
            <p id="dialogo-mensaje"></p>
            <div class="dialogo-botones" id="dialogo-botones"></div>
        </div>
    `;
    document.body.appendChild(overlay);
    return overlay;
}

// Devuelve una Promise<boolean>: true si confirma, false si cancela
function confirmarAccion(mensaje) {
    return new Promise((resolve) => {
        const overlay = _crearOverlayDialogo();
        overlay.querySelector('#dialogo-mensaje').textContent = mensaje;
        const botones = overlay.querySelector('#dialogo-botones');
        botones.innerHTML = `
            <button type="button" class="dialogo-btn-cancelar">Cancelar</button>
            <button type="button" class="dialogo-btn-confirmar">Eliminar</button>
        `;

        function cerrar(resultado) {
            overlay.classList.remove('activo');
            resolve(resultado);
        }

        botones.querySelector('.dialogo-btn-cancelar').onclick = () => cerrar(false);
        botones.querySelector('.dialogo-btn-confirmar').onclick = () => cerrar(true);
        overlay.classList.add('activo');
    });
}

// Aviso simple con un solo botón "Entendido" (reemplaza alert())
function mostrarAviso(mensaje) {
    return new Promise((resolve) => {
        const overlay = _crearOverlayDialogo();
        overlay.querySelector('#dialogo-mensaje').textContent = mensaje;
        const botones = overlay.querySelector('#dialogo-botones');
        botones.innerHTML = `<button type="button" class="dialogo-btn-ok">Entendido</button>`;

        function cerrar() {
            overlay.classList.remove('activo');
            resolve();
        }

        botones.querySelector('.dialogo-btn-ok').onclick = cerrar;
        overlay.classList.add('activo');
    });
}

// Un pequeño bloque "no hay nada acá", con un ícono de libro simple en vez de solo texto
function crearEstadoVacio(mensaje) {
    const div = document.createElement('div');
    div.className = 'estado-vacio';
    div.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M3 5.5C3 4.7 3.7 4 4.5 4H11v16H4.5c-.8 0-1.5-.7-1.5-1.5v-13z"/>
            <path d="M21 5.5c0-.8-.7-1.5-1.5-1.5H13v16h6.5c.8 0 1.5-.7 1.5-1.5v-13z"/>
        </svg>
        <p></p>
    `;
    div.querySelector('p').textContent = mensaje;
    return div;
}

// Abre una imagen agrandada en un cuadro flotante centrado, sin cambiar de
// página (se usa para la foto de perfil y la foto de portada, pero sirve
// para cualquier imagen). El cuadro mide la mitad del ancho y la mitad del
// alto de la pantalla en escritorio (ver .visor-imagen-caja en styles.css);
// en celular se agranda vía media query para aprovechar mejor el espacio.
function abrirVisorImagen(url) {
    let overlay = document.getElementById('visor-imagen-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'visor-imagen-overlay';
        overlay.className = 'visor-imagen-overlay';
        overlay.innerHTML = `
            <div class="visor-imagen-caja">
                <span class="visor-imagen-cerrar">&times;</span>
                <img class="visor-imagen-img" alt="Imagen ampliada">
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay || e.target.classList.contains('visor-imagen-cerrar')) {
                overlay.classList.remove('activo');
            }
        });
    }
    overlay.querySelector('.visor-imagen-img').src = url;
    overlay.classList.add('activo');
}

// Ajusta el padding-top del body para que siempre coincida con la altura
// real del header (que es "fixed"). Antes era un valor fijo en el CSS, pero
// en celular el header puede pasar a ocupar 2 líneas (título + buscador +
// botones), así que un valor fijo dejaba contenido tapado. Se recalcula al
// cargar, al cambiar de tamaño la ventana, y un rato después de cada scroll
// (por si el header se agranda/achica con la clase "shrink").
(function ajustarEspacioHeader() {
    function ajustar() {
        const header = document.querySelector('header');
        if (!header) return;
        document.body.style.paddingTop = header.offsetHeight + 'px';
    }
    let temporizador;
    function ajustarConDelay() {
        clearTimeout(temporizador);
        temporizador = setTimeout(ajustar, 150);
    }
    document.addEventListener('DOMContentLoaded', ajustar);
    window.addEventListener('load', ajustar);
    window.addEventListener('resize', ajustarConDelay);
    window.addEventListener('scroll', ajustarConDelay);
})();

// Convierte el título de un libro en un link a su página de detalle
// (libro.html), manteniendo el mismo look que si fuera texto plano. Se usa
// en todas partes donde aparece un título de libro (reseñas, estanterías,
// lecturas en curso) — EXCEPTO en los resultados del buscador/autocompletado
// de libros (libro-buscador.js), donde pinchar el título selecciona el libro
// para el formulario en vez de abrir su ficha.
// `elemento`: la etiqueta a crear (por defecto 'a', pero puede envolver un h2/h3 pasándole un texto).
function crearLinkLibro(titulo, autor, portada_url) {
    const link = document.createElement('a');
    link.href = `libro.html?titulo=${encodeURIComponent(titulo || '')}&autor=${encodeURIComponent(autor || '')}&portada=${encodeURIComponent(portada_url || '')}`;
    link.textContent = titulo;
    link.style.cssText = 'color: inherit; text-decoration: none;';
    link.addEventListener('mouseenter', () => { link.style.textDecoration = 'underline'; });
    link.addEventListener('mouseleave', () => { link.style.textDecoration = 'none'; });
    // Si el link vive dentro de una tarjeta que también abre algo al hacer
    // click (ej: la reseña completa), que pinchar el título no dispare eso.
    link.addEventListener('click', (e) => e.stopPropagation());
    return link;
}
