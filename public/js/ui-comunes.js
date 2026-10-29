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

// --- ICONOS DE LÍNEA (SVG en línea, sin librería externa) ---
// Reemplazan a los emojis donde se quiere un look más prolijo: todos heredan el
// color del texto (currentColor), así que funcionan igual en modo claro y noche.
const ICONOS_SVG = {
    libro: '<path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z"/>',
    usuarios: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    lapiz: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    estrella: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    luna: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
    sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
    medalla: '<circle cx="12" cy="8" r="6"/><path d="M15.48 12.89L17 22l-5-3-5 3 1.52-9.11"/>',
    carnet: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16c.5-1.6 1.7-2.5 3-2.5s2.5.9 3 2.5M15 10h3M15 14h3"/>',
    fantasma: '<path d="M9 10h.01M15 10h.01"/><path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z"/>',
    lupa: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    campana: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    cuadricula: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
    lista: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
    calendario: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    casa: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
    mensaje: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    estante: '<path d="M16 6l4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>',
    ajustes: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    tendencia: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>'
};
function iconoSvg(nombre, tam = 18) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${tam}" height="${tam}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0">${ICONOS_SVG[nombre] || ''}</svg>`;
}
// Rellena con su ícono de línea todo elemento marcado con data-icono="nombre"
function hidratarIconos(raiz = document) {
    raiz.querySelectorAll('[data-icono]').forEach(el => {
        el.innerHTML = iconoSvg(el.dataset.icono, Number(el.dataset.tam) || 18);
    });
}

// --- MODO NOCHE ---
// El tema vive en <html data-theme="dark"> (ver las variables en styles.css). Se
// guarda en localStorage y cada página lo aplica en el <head> antes de pintar,
// para que no haya un destello claro al cargar.
function temaActual() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}
function aplicarTema(tema) {
    if (tema === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('tema', tema); } catch (e) { /* sin almacenamiento: no se recuerda */ }
    window.dispatchEvent(new CustomEvent('tema-cambiado', { detail: tema }));
}

// --- SCROLL INFINITO ---
// Ayudante genérico: pone un "centinela" invisible junto a una lista y, cuando
// la persona se acerca a él haciendo scroll, llama a `cargarMas()` para traer la
// siguiente página. Se usa en el feed, el muro, las notificaciones y los mensajes.
//
//   contenedor : elemento donde van los items (el centinela se pone justo después)
//   cargarMas  : async () => boolean. Trae y pinta la siguiente página; devuelve
//                true si TODAVÍA hay más, false si ya no queda nada.
//   raiz       : elemento con scroll propio (ej. el panel de notificaciones).
//                null = la ventana entera.
//   centinelaEn: 'despues' (defecto: debajo del contenedor) o 'inicio' (primer hijo
//                del contenedor, para listas que crecen hacia arriba como el chat).
//   margen     : px de anticipación, para que la siguiente página ya esté lista
//                antes de que la persona llegue al final.
//   mensajeFin : texto a mostrar cuando ya no hay más (opcional).
//
// Devuelve { centinela, reiniciar(), detener() }. La primera página también la
// dispara el centinela apenas queda a la vista, así que quien lo usa no tiene
// que hacer una carga inicial aparte (a menos que la quiera hacer él, como el chat).
function crearScrollInfinito({ contenedor, cargarMas, raiz = null, centinelaEn = 'despues', margen = 300, mensajeFin = '' }) {
    const centinela = document.createElement('div');
    centinela.className = 'scroll-infinito-centinela';
    // Altura fija: así el texto "Cargando más..." aparece/desaparece sin mover el contenido (importa en el chat)
    centinela.style.cssText = 'height: 36px; display: flex; align-items: center; justify-content: center; font-size: 0.78rem; color: var(--color-texto-suave); flex-shrink: 0; box-sizing: border-box;';

    let cargando = false;
    let terminado = false;
    let detenido = false;
    let enError = false;
    let generacion = 0; // sube con cada reiniciar(), para ignorar cargas que venían en camino

    function colocar() {
        if (centinelaEn === 'inicio') contenedor.prepend(centinela);
        else contenedor.after(centinela);
    }

    // Navegadores muy viejos sin IntersectionObserver: cargamos todo de una vez.
    if (!('IntersectionObserver' in window)) {
        colocar();
        (async () => {
            for (let i = 0; i < 50; i++) {
                if (!(await cargarMas())) break;
            }
        })();
        return { centinela, reiniciar() {}, detener() { centinela.remove(); } };
    }

    async function intentarCargar(forzar = false) {
        if (cargando || terminado || detenido) return;
        if (enError && !forzar) return; // tras un error no insistimos solos
        cargando = true;
        enError = false;
        centinela.style.cursor = '';
        centinela.textContent = 'Cargando más...';
        const miGeneracion = generacion;

        let hayMas = false;
        try {
            hayMas = await cargarMas();
        } catch (error) {
            if (miGeneracion !== generacion) return; // ya se reinició: este error no importa
            enError = true;
            cargando = false;
            centinela.style.cursor = 'pointer';
            centinela.textContent = 'No se pudo cargar. Toca aquí para reintentar.';
            return;
        }

        if (miGeneracion !== generacion) return; // se reinició mientras cargaba: descartamos este resultado
        cargando = false;
        if (detenido) return;
        if (!hayMas) {
            terminado = true;
            observador.unobserve(centinela);
            centinela.textContent = mensajeFin;
        } else {
            centinela.textContent = '';
            // Si la página cargada no alcanzó a llenar la pantalla, el centinela
            // sigue a la vista y el observador no volvería a avisar: lo re-observamos.
            observador.unobserve(centinela);
            observador.observe(centinela);
        }
    }

    const observador = new IntersectionObserver((entradas) => {
        if (entradas.some(e => e.isIntersecting)) intentarCargar();
    }, { root: raiz, rootMargin: `${margen}px 0px ${margen}px 0px` });

    centinela.addEventListener('click', () => { if (enError) intentarCargar(true); });

    colocar();
    observador.observe(centinela);

    return {
        centinela,
        // Para volver a empezar desde la primera página (ej. tras publicar algo nuevo
        // o al cambiar de pestaña): quien lo llama vacía el contenedor y reinicia.
        reiniciar() {
            generacion++;
            terminado = false;
            cargando = false;
            enError = false;
            detenido = false;
            centinela.textContent = '';
            colocar();
            observador.unobserve(centinela);
            observador.observe(centinela);
        },
        detener() {
            detenido = true;
            observador.disconnect();
            centinela.remove();
        }
    };
}

// --- FEED MEZCLADO Y PAGINADO ---
// El feed general y el muro de cada persona mezclan varios tipos de cosas (posts,
// reseñas, preguntas), cada una con su propio endpoint paginado. Este ayudante las
// va trayendo por páginas y las entrega ya mezcladas por fecha. Para no perder ni
// repetir nada, cada tipo tiene su "cursor" (el id del último elemento de ese tipo
// que YA se entregó): en cada página se pide `tamano` de cada tipo, se mezclan, se
// entregan solo las `tamano` más nuevas, y el cursor de cada tipo avanza únicamente
// hasta donde se llegó a entregar. Lo que se trajo de más se vuelve a pedir después.
//
//   fuentes: [{ tipo, url, clave, params }]  ej. { tipo: 'post', url: '/api/posts',
//            clave: 'posts', params: { username: 'ana' } }
//   siguiente(): async -> { items: [{ _tipo, ...fila }], hayMas, obsoleto }
//   reiniciar(): vuelve a la primera página (las respuestas pendientes se descartan)
function crearPaginadorMezclado(fuentes, tamano = 15) {
    let cursores, agotados, entregados, generacion = 0;

    function reiniciar() {
        generacion++;
        cursores = {};
        agotados = {};
        entregados = new Set(); // red de seguridad contra repetidos
        fuentes.forEach(f => { cursores[f.tipo] = null; agotados[f.tipo] = false; });
    }
    reiniciar();

    async function siguiente() {
        const miGeneracion = generacion;

        const traidos = await Promise.all(fuentes.map(async (f) => {
            if (agotados[f.tipo]) return { tipo: f.tipo, filas: [], hasMore: false };
            const params = new URLSearchParams(f.params || {});
            params.set('limit', tamano);
            if (cursores[f.tipo]) params.set('before', cursores[f.tipo]);
            const resp = await fetch(`${f.url}?${params}`);
            if (!resp.ok) throw new Error('Error al cargar ' + f.tipo);
            const data = await resp.json();
            return { tipo: f.tipo, filas: data[f.clave] || [], hasMore: !!data.hasMore };
        }));
        if (miGeneracion !== generacion) return { items: [], hayMas: false, obsoleto: true };

        const mezclados = traidos
            .flatMap(({ tipo, filas }) => filas.map(fila => ({ _tipo: tipo, ...fila })))
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const elegidos = mezclados.slice(0, tamano);
        const idsElegidos = new Set(elegidos.map(e => `${e._tipo}:${e.id}`));

        // Avanzamos el cursor de cada tipo solo por el tramo inicial que sí se entregó
        let hayMas = false;
        traidos.forEach(({ tipo, filas, hasMore }) => {
            let cursor = cursores[tipo];
            let quedanSinEntregar = false;
            for (const fila of filas) {
                if (!quedanSinEntregar && idsElegidos.has(`${tipo}:${fila.id}`)) cursor = fila.id;
                else quedanSinEntregar = true;
            }
            cursores[tipo] = cursor;
            const quedaMas = quedanSinEntregar || hasMore;
            agotados[tipo] = !quedaMas;
            if (quedaMas) hayMas = true;
        });

        const items = elegidos.filter(e => {
            const clave = `${e._tipo}:${e.id}`;
            if (entregados.has(clave)) return false;
            entregados.add(clave);
            return true;
        });
        return { items, hayMas, obsoleto: false };
    }

    return { siguiente, reiniciar };
}

// Comprime y redimensiona una imagen en el navegador antes de subirla (se usa
// para la foto de perfil y la foto de portada). Sin esto, cada foto se
// guardaba tal cual llegara del celular/cámara (a veces varios MB) directo
// como texto en la base de datos, lo que la infla rápido. Devuelve un data
// URL en JPEG, ya recortado a un lado máximo, bajando la calidad un par de
// veces si hiciera falta para no pasarse del límite que acepta el servidor.
function comprimirImagenParaSubir(archivo, { maxLado = 1600, calidadInicial = 0.82 } = {}) {
    return new Promise((resolve, reject) => {
        const lector = new FileReader();
        lector.onerror = () => reject(new Error('No se pudo leer el archivo.'));
        lector.onload = () => {
            const imagen = new Image();
            imagen.onerror = () => reject(new Error('El archivo no es una imagen válida.'));
            imagen.onload = () => {
                let { width, height } = imagen;
                if (width > maxLado || height > maxLado) {
                    if (width >= height) {
                        height = Math.round(height * (maxLado / width));
                        width = maxLado;
                    } else {
                        width = Math.round(width * (maxLado / height));
                        height = maxLado;
                    }
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(imagen, 0, 0, width, height);

                // ~2.6M caracteres de data URL son ~1.9MB reales; si se pasa de
                // ahí, bajamos la calidad e intentamos de nuevo antes de rendirnos.
                (function intentar(calidad) {
                    const dataUrl = canvas.toDataURL('image/jpeg', calidad);
                    if (dataUrl.length > 2.6 * 1024 * 1024 && calidad > 0.4) {
                        intentar(calidad - 0.15);
                    } else {
                        resolve(dataUrl);
                    }
                })(calidadInicial);
            };
            imagen.src = lector.result;
        };
        lector.readAsDataURL(archivo);
    });
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
