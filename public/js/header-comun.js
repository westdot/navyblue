// header-comun.js
// Lógica de header compartida por todas las páginas: convierte el título NAVYBLUE
// en botón de inicio, muestra el menú de usuario (nombre + Configuración/Cerrar
// sesión) y el buscador con filtro por categoría, cuando hay sesión activa.

async function obtenerSesion() {
    try {
        const response = await fetch('/api/session');
        return await response.json();
    } catch (error) {
        return { loggedIn: false };
    }
}

// Cierra cualquier panel flotante (menú de usuario o resultados de búsqueda)
// al hacer clic fuera de él.
function cerrarAlClickAfuera(panel, disparador) {
    document.addEventListener('click', (e) => {
        if (!panel.contains(e.target) && !disparador.contains(e.target)) {
            panel.style.display = 'none';
        }
    });
}

function crearMenuUsuario(usuario) {
    const contenedor = document.createElement('div');
    contenedor.className = 'menu-usuario';
    contenedor.style.cssText = 'position: relative; display: flex; align-items: center; gap: 6px;';
    contenedor.innerHTML = `
        <a href="muro.html" style="color: white; font-weight: bold; font-size: 15px; text-decoration: none;">${usuario.username}</a>
        <button type="button" class="btn-flecha-usuario" style="background: none; border: none; color: white; font-size: 12px; cursor: pointer; padding: 4px;">▾</button>
        <div class="dropdown-usuario" style="display: none; position: absolute; right: 0; top: 130%; background: white; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); overflow: hidden; min-width: 160px; z-index: 200;">
            <a href="perfil.html" style="display: block; padding: 10px 15px; color: #333; text-decoration: none;">Configuración</a>
            <a href="#" class="btn-cerrar-sesion" style="display: block; padding: 10px 15px; color: #d9534f; text-decoration: none;">Cerrar Sesión</a>
        </div>
    `;

    const btnFlecha = contenedor.querySelector('.btn-flecha-usuario');
    const dropdown = contenedor.querySelector('.dropdown-usuario');

    btnFlecha.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
    });
    cerrarAlClickAfuera(dropdown, btnFlecha);

    contenedor.querySelector('.btn-cerrar-sesion').addEventListener('click', async (e) => {
        e.preventDefault();
        await fetch('/api/logout', { method: 'POST' });
        localStorage.removeItem('usuarioLogueado');
        window.location.href = 'index.html';
    });

    return contenedor;
}

function crearBotonModoCompacto() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-modo-compacto';
    btn.title = 'Cambiar densidad del feed';

    function actualizarIcono() {
        const activo = document.body.classList.contains('modo-compacto');
        btn.textContent = activo ? '☰' : '☷';
    }

    // Se recuerda entre páginas (es solo una preferencia visual, no datos sensibles)
    if (localStorage.getItem('modoCompacto') === '1') {
        document.body.classList.add('modo-compacto');
    }
    actualizarIcono();

    btn.addEventListener('click', () => {
        document.body.classList.toggle('modo-compacto');
        localStorage.setItem('modoCompacto', document.body.classList.contains('modo-compacto') ? '1' : '0');
        actualizarIcono();
    });

    return btn;
}

function crearCampanaNotificaciones() {
    const contenedor = document.createElement('div');
    contenedor.style.cssText = 'position: relative; display: flex; align-items: center;';
    contenedor.innerHTML = `
        <button type="button" class="btn-campana" style="background: none; border: none; color: white; cursor: pointer; font-size: 1.1rem; padding: 6px; position: relative;">
            🔔
            <span class="badge-notificaciones" style="display: none; position: absolute; top: 0; right: 0; background: #c17b83; color: white; border-radius: 999px; font-size: 0.65rem; padding: 1px 5px; font-weight: bold;"></span>
        </button>
        <div class="panel-notificaciones" style="display: none; position: absolute; right: 0; top: 130%; background: white; color: #333; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); min-width: 280px; max-height: 350px; overflow-y: auto; z-index: 200;"></div>
    `;

    const btn = contenedor.querySelector('.btn-campana');
    const badge = contenedor.querySelector('.badge-notificaciones');
    const panel = contenedor.querySelector('.panel-notificaciones');

    cerrarAlClickAfuera(panel, btn);

    // Formatea "hace 5m/2h/3d", igual que en los posts
    function tiempoRelativo(fechaBD) {
        const fecha = new Date(fechaBD.replace(' ', 'T') + 'Z');
        const diffSeg = Math.floor((new Date() - fecha) / 1000);
        if (diffSeg < 60) return 'Ahora';
        const diffMin = Math.floor(diffSeg / 60);
        if (diffMin < 60) return `${diffMin}m`;
        const diffHoras = Math.floor(diffMin / 60);
        if (diffHoras < 24) return `${diffHoras}h`;
        return `${Math.floor(diffHoras / 24)}d`;
    }

    async function actualizarBadge() {
        try {
            const resp = await fetch('/api/notifications');
            const data = await resp.json();
            if (data.noLeidas > 0) {
                badge.textContent = data.noLeidas > 9 ? '9+' : data.noLeidas;
                badge.style.display = 'block';
            } else {
                badge.style.display = 'none';
            }
            return data.notifications || [];
        } catch (error) {
            return [];
        }
    }

    async function abrirPanel() {
        const abierto = panel.style.display === 'block';
        if (abierto) {
            panel.style.display = 'none';
            return;
        }

        const notificaciones = await actualizarBadge();
        panel.innerHTML = '';

        if (notificaciones.length === 0) {
            panel.innerHTML = '<p style="padding: 15px; margin: 0; color: #888; font-size: 0.85rem;">No tienes notificaciones todavía.</p>';
        } else {
            notificaciones.forEach(n => {
                const item = document.createElement('a');
                item.href = `muro.html?usuario=${encodeURIComponent(n.actor_username)}`;
                item.style.cssText = `display: block; padding: 10px 15px; border-bottom: 1px solid #eee; text-decoration: none; color: #333; font-size: 0.83rem; ${n.leida ? '' : 'background: #eef2f7;'}`;
                const mensaje = document.createElement('div');
                mensaje.textContent = n.mensaje;
                const fecha = document.createElement('div');
                fecha.style.cssText = 'font-size: 0.72rem; color: #999; margin-top: 2px;';
                fecha.textContent = tiempoRelativo(n.created_at);
                item.appendChild(mensaje);
                item.appendChild(fecha);
                panel.appendChild(item);
            });
        }

        panel.style.display = 'block';

        // Al abrir el panel, marcamos todo como leído y apagamos el contador
        if (badge.style.display !== 'none') {
            try {
                await fetch('/api/notifications/marcar-leidas', { method: 'POST' });
                badge.style.display = 'none';
            } catch (error) { /* si falla, no pasa nada grave */ }
        }
    }

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        abrirPanel();
    });

    actualizarBadge(); // contador inicial al cargar la página

    return contenedor;
}

function crearBuscador() {
    const contenedor = document.createElement('div');
    contenedor.className = 'buscador-header';
    contenedor.style.cssText = 'position: relative; display: flex; align-items: center;';
    contenedor.innerHTML = `
        <input type="text" class="buscador-input" placeholder="Buscar libros, usuarios..."
               style="padding: 8px 38px 8px 14px; border-radius: 999px; border: 1px solid #ccc; font-size: 0.85rem; width: 190px; background: white; color: #333;">
        <button type="button" class="buscador-boton" title="Buscar"
                style="position: absolute; right: 4px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; padding: 4px; display: flex;">
            🔍
        </button>
    `;

    const input = contenedor.querySelector('.buscador-input');
    const boton = contenedor.querySelector('.buscador-boton');

    function irABuscar() {
        const q = input.value.trim();
        if (!q) return;
        window.location.href = `buscar.html?q=${encodeURIComponent(q)}`;
    }

    boton.addEventListener('click', irABuscar);
    input.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') irABuscar();
    });

    return contenedor;
}

// Punto de entrada: llama esto en cada página con DOMContentLoaded.
// opciones.reemplazarBotonesInvitado = true en páginas donde, al haber sesión,
// hay que ocultar botones de invitado (Iniciar Sesión / Registrarse).
async function montarHeaderComun(opciones = {}) {
    const sesion = await obtenerSesion();

    // El título NAVYBLUE (si existe en esta página) pasa a ser el botón de inicio
    const titulo = document.querySelector('.header-title h1');
    if (titulo && !titulo.closest('a')) {
        const link = document.createElement('a');
        link.href = 'index.html';
        link.style.cssText = 'color: inherit; text-decoration: none;';
        titulo.parentNode.insertBefore(link, titulo);
        link.appendChild(titulo);
    }

    const headerAcciones = document.querySelector('.header-acciones');
    if (!headerAcciones) return sesion;

    if (sesion.loggedIn) {
        localStorage.setItem('usuarioLogueado', JSON.stringify(sesion.user));

        if (opciones.reemplazarBotonesInvitado) {
            headerAcciones.innerHTML = '';
        }
        // El botón "Volver al Inicio" ya no hace falta si el título NAVYBLUE cumple esa función
        const btnVolver = headerAcciones.querySelector('a[href="index.html"]');
        if (titulo && btnVolver) btnVolver.remove();

        headerAcciones.appendChild(crearBuscador());
        headerAcciones.appendChild(crearBotonModoCompacto());
        headerAcciones.appendChild(crearCampanaNotificaciones());
        headerAcciones.appendChild(crearMenuUsuario(sesion.user));
    } else {
        localStorage.removeItem('usuarioLogueado');
    }

    return sesion;
}
