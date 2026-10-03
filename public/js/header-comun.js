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
    contenedor.style.cssText = 'position: relative; display: flex; align-items: center; height: 34px; gap: 7px;';
    contenedor.innerHTML = `
        <a href="muro.html" style="color: white; font-weight: 700; font-size: 13.5px; text-decoration: none; line-height: 1;">${usuario.username}</a>
        <button type="button" class="btn-flecha-usuario" style="background: rgba(255,255,255,0.14); border: none; color: white; font-size: 11px; cursor: pointer; width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">▾</button>
        <div class="dropdown-usuario" style="display: none; position: absolute; right: 0; top: calc(100% + 8px); background: var(--color-tarjeta); border: 1px solid var(--color-borde); border-radius: 9px; box-shadow: 0 6px 16px rgba(43,37,32,0.18); overflow: hidden; min-width: 170px; z-index: 200;">
            <a href="estanterias.html" style="display: block; padding: 10px 14px; color: var(--color-texto); text-decoration: none; font-size: 0.85rem;">Mis Estanterías</a>
            <a href="perfil.html" style="display: block; padding: 10px 14px; color: var(--color-texto); text-decoration: none; font-size: 0.85rem; border-top: 1px solid var(--color-borde);">Configuración</a>
            <a href="#" class="btn-cerrar-sesion" style="display: block; padding: 10px 14px; color: var(--color-dislike); text-decoration: none; font-size: 0.85rem; border-top: 1px solid var(--color-borde);">Cerrar Sesión</a>
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
    btn.style.cssText = 'background: rgba(255,255,255,0.14); border: none; color: white; cursor: pointer; width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 15px; flex-shrink: 0;';

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
        <button type="button" class="btn-campana" style="background: rgba(255,255,255,0.14); border: none; color: white; cursor: pointer; width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 15px; position: relative; flex-shrink: 0;">
            🔔
            <span class="badge-notificaciones" style="display: none; position: absolute; top: -3px; right: -3px; background: var(--color-acento); color: var(--color-texto); border-radius: 999px; font-size: 0.62rem; min-width: 16px; height: 16px; padding: 0 3px; font-weight: 700; align-items: center; justify-content: center; border: 2px solid var(--color-navy-oscuro); line-height: 1;"></span>
        </button>
        <div class="panel-notificaciones" style="display: none; position: absolute; right: 0; top: calc(100% + 8px); background: var(--color-tarjeta); color: var(--color-texto); border: 1px solid var(--color-borde); border-radius: 9px; box-shadow: 0 6px 16px rgba(43,37,32,0.18); min-width: 280px; max-height: 350px; overflow-y: auto; z-index: 200;"></div>
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

    // Solo necesitamos el contador de no leídas: pedimos 1 notificación para no traer de más
    async function actualizarBadge() {
        try {
            const resp = await fetch('/api/notifications?limit=1');
            const data = await resp.json();
            pintarBadge(data.noLeidas);
        } catch (error) { /* si falla, dejamos el contador como estaba */ }
    }

    function pintarBadge(noLeidas) {
        if (noLeidas > 0) {
            badge.textContent = noLeidas > 9 ? '9+' : noLeidas;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    }

    function crearItemNotificacion(n) {
        const item = document.createElement('a');
        item.href = n.destino || `muro.html?usuario=${encodeURIComponent(n.actor_username)}`;
        item.style.cssText = `display: block; padding: 10px 15px; border-bottom: 1px solid var(--color-borde); text-decoration: none; color: var(--color-texto); font-size: 0.83rem; ${n.leida ? '' : 'background: #eef2f7;'}`;
        const mensaje = document.createElement('div');
        mensaje.textContent = n.mensaje;
        const fecha = document.createElement('div');
        fecha.style.cssText = 'font-size: 0.72rem; color: var(--color-texto-suave); margin-top: 2px;';
        fecha.textContent = tiempoRelativo(n.created_at);
        item.appendChild(mensaje);
        item.appendChild(fecha);
        return item;
    }

    // Scroll infinito dentro del panel: al abrirlo se traen las 20 más nuevas y, si
    // hay más, al llegar al final del panel se piden las siguientes 20.
    let scrollNotificaciones = null;

    async function abrirPanel() {
        const abierto = panel.style.display === 'block';
        if (abierto) {
            panel.style.display = 'none';
            return;
        }

        if (scrollNotificaciones) { scrollNotificaciones.detener(); scrollNotificaciones = null; }

        let data = { notifications: [], noLeidas: 0, hasMore: false };
        try {
            const resp = await fetch('/api/notifications?limit=20');
            if (resp.ok) data = await resp.json();
        } catch (error) { /* mostramos el panel vacío */ }
        pintarBadge(data.noLeidas);

        panel.innerHTML = '';
        const notificaciones = data.notifications || [];

        if (notificaciones.length === 0) {
            panel.innerHTML = '<p style="padding: 15px; margin: 0; color: var(--color-texto-suave); font-size: 0.85rem;">No tienes notificaciones todavía.</p>';
        } else {
            const lista = document.createElement('div');
            panel.appendChild(lista);
            notificaciones.forEach(n => lista.appendChild(crearItemNotificacion(n)));
            let ultimoId = notificaciones[notificaciones.length - 1].id;

            if (data.hasMore) {
                scrollNotificaciones = crearScrollInfinito({
                    contenedor: lista,
                    raiz: panel,
                    margen: 100,
                    cargarMas: async () => {
                        const resp = await fetch(`/api/notifications?limit=20&before=${ultimoId}`);
                        if (!resp.ok) throw new Error('Error al cargar notificaciones');
                        const pagina = await resp.json();
                        (pagina.notifications || []).forEach(n => lista.appendChild(crearItemNotificacion(n)));
                        if (pagina.notifications && pagina.notifications.length > 0) {
                            ultimoId = pagina.notifications[pagina.notifications.length - 1].id;
                        }
                        return !!pagina.hasMore;
                    }
                });
            }
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
    contenedor.style.cssText = 'display: flex; align-items: center; height: 34px; background: rgba(255,255,255,0.14); border-radius: 999px; padding: 0 12px; gap: 7px;';
    contenedor.innerHTML = `
        <button type="button" class="buscador-boton" title="Buscar"
                style="background: none; border: none; cursor: pointer; padding: 0; display: flex; align-items: center; flex-shrink: 0; font-size: 13px; opacity: 0.85;">
            🔍
        </button>
        <input type="text" class="buscador-input" placeholder="Buscar libros, usuarios..."
               style="border: none; background: transparent; font-size: 0.82rem; color: white; height: 100%;">
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
