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

function crearBuscador() {
    const contenedor = document.createElement('div');
    contenedor.className = 'buscador-header';
    contenedor.style.cssText = 'position: relative; display: flex; align-items: center; gap: 4px;';
    contenedor.innerHTML = `
        <select class="buscador-tipo" style="padding: 7px; border-radius: 6px; border: none; font-size: 0.85rem;">
            <option value="usuarios">Usuarios</option>
            <option value="libros">Libros</option>
            <option value="editoriales">Editoriales</option>
            <option value="mangas">Mangas</option>
            <option value="novelas-ligeras">Novelas Ligeras</option>
        </select>
        <input type="text" class="buscador-input" placeholder="Buscar..." style="padding: 7px 10px; border-radius: 6px; border: none; font-size: 0.85rem; width: 130px;">
        <div class="buscador-resultados" style="display: none; position: absolute; top: 130%; left: 0; background: white; color: #333; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); min-width: 260px; max-height: 320px; overflow-y: auto; z-index: 200;"></div>
    `;

    const select = contenedor.querySelector('.buscador-tipo');
    const input = contenedor.querySelector('.buscador-input');
    const resultados = contenedor.querySelector('.buscador-resultados');

    cerrarAlClickAfuera(resultados, contenedor);

    let temporizador = null;
    async function buscar() {
        const tipo = select.value;
        const q = input.value.trim();

        if (!q) {
            resultados.style.display = 'none';
            return;
        }

        try {
            const response = await fetch(`/api/search?tipo=${encodeURIComponent(tipo)}&q=${encodeURIComponent(q)}`);
            const data = await response.json();

            resultados.innerHTML = '';

            if (!data.implementado) {
                const p = document.createElement('p');
                p.style.cssText = 'padding: 12px 15px; margin: 0; color: #666;';
                p.textContent = 'Aún no implementado para esta categoría.';
                resultados.appendChild(p);
            } else if (data.resultados.length === 0) {
                const p = document.createElement('p');
                p.style.cssText = 'padding: 12px 15px; margin: 0; color: #666;';
                p.textContent = 'Sin resultados.';
                resultados.appendChild(p);
            } else {
                data.resultados.forEach(item => {
                    const div = document.createElement('div');
                    div.style.cssText = 'padding: 10px 15px; border-bottom: 1px solid #eee;';
                    const titulo = document.createElement('div');
                    titulo.style.fontWeight = 'bold';
                    titulo.textContent = item.titulo;
                    div.appendChild(titulo);
                    if (item.subtitulo) {
                        const sub = document.createElement('div');
                        sub.style.cssText = 'font-size: 0.8rem; color: #666;';
                        sub.textContent = item.subtitulo;
                        div.appendChild(sub);
                    }
                    resultados.appendChild(div);
                });
            }

            resultados.style.display = 'block';
        } catch (error) {
            resultados.innerHTML = '<p style="padding: 12px 15px; margin: 0; color: #666;">No se pudo buscar.</p>';
            resultados.style.display = 'block';
        }
    }

    input.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') { buscar(); return; }
        clearTimeout(temporizador);
        temporizador = setTimeout(buscar, 400); // pequeña espera para no buscar en cada tecla
    });
    select.addEventListener('change', buscar);

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
        headerAcciones.appendChild(crearMenuUsuario(sesion.user));
    } else {
        localStorage.removeItem('usuarioLogueado');
    }

    return sesion;
}
