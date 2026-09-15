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
