// posts-comunes.js
// Lógica compartida entre index.html y muro.html para:
// - la barra de acciones de cada post (comentar / repostear / like)
// - abrir el detalle de un post con sus comentarios, reemplazando el
//   contenido de la columna derecha (y poder volver a lo que había antes)

// Cachea el username de la sesión actual para saber qué comentarios son
// "míos" (y así poder mostrarles el botón de eliminar). Se pide una sola vez.
let _usuarioSesionCache = null;
async function obtenerUsuarioSesion() {
    if (_usuarioSesionCache !== null) return _usuarioSesionCache;
    try {
        const resp = await fetch('/api/session');
        const data = await resp.json();
        _usuarioSesionCache = data.loggedIn ? data.user.username : '';
    } catch (error) {
        _usuarioSesionCache = '';
    }
    return _usuarioSesionCache;
}

// Convierte un texto con @menciones (ej: "hola @takato") en nodos de texto +
// links clickeables a su muro. Nunca usa innerHTML con el texto del post, así
// que sigue siendo seguro contra XSS igual que antes (solo texto plano + <a>).
function renderizarTextoConMenciones(texto) {
    const frag = document.createDocumentFragment();
    const regex = /@(\w+)/g;
    let ultimo = 0;
    let match;
    while ((match = regex.exec(texto)) !== null) {
        if (match.index > ultimo) {
            frag.appendChild(document.createTextNode(texto.slice(ultimo, match.index)));
        }
        const link = document.createElement('a');
        link.href = `muro.html?usuario=${encodeURIComponent(match[1])}`;
        link.textContent = '@' + match[1];
        link.style.cssText = 'color: var(--color-navy); font-weight: bold; text-decoration: none;';
        link.addEventListener('click', (e) => e.stopPropagation()); // no abrir el detalle del post al pinchar la mención
        frag.appendChild(link);
        ultimo = regex.lastIndex;
    }
    if (ultimo < texto.length) {
        frag.appendChild(document.createTextNode(texto.slice(ultimo)));
    }
    return frag;
}

// Crea la barra de botones 💬 🔄 ❤️ de un post.
// `onAbrirDetalle` se llama al pinchar el botón de comentar.
function crearBarraAcciones(post, onAbrirDetalle) {
    const acciones = document.createElement('div');
    acciones.className = 'post-acciones';

    const btnComentar = document.createElement('button');
    btnComentar.type = 'button';
    btnComentar.textContent = `💬 ${post.comments_count || 0}`;
    btnComentar.addEventListener('click', (e) => {
        e.stopPropagation();
        onAbrirDetalle();
    });

    const btnRepostear = document.createElement('button');
    btnRepostear.type = 'button';
    btnRepostear.textContent = `🔄 ${post.reposts_count || 0}`;
    if (post.reposted_by_me) btnRepostear.style.color = '#198754';
    btnRepostear.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
            const resp = await fetch(`/api/posts/${post.id}/repost`, { method: 'POST' });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok) {
                mostrarAviso(data.error || 'Debes iniciar sesión para repostear.');
                return;
            }
            post.reposted_by_me = data.reposted;
            post.reposts_count = data.count;
            btnRepostear.textContent = `🔄 ${data.count}`;
            btnRepostear.style.color = data.reposted ? '#198754' : '';
        } catch (error) {
            mostrarAviso('No se pudo conectar con el servidor.');
        }
    });

    const btnLike = document.createElement('button');
    btnLike.type = 'button';
    btnLike.textContent = `❤️ ${post.likes_count || 0}`;
    if (post.liked_by_me) btnLike.style.color = '#e63946';
    btnLike.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
            const resp = await fetch(`/api/posts/${post.id}/like`, { method: 'POST' });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok) {
                mostrarAviso(data.error || 'Debes iniciar sesión para dar like.');
                return;
            }
            post.liked_by_me = data.liked;
            post.likes_count = data.count;
            btnLike.textContent = `❤️ ${data.count}`;
            btnLike.style.color = data.liked ? '#e63946' : '';
        } catch (error) {
            mostrarAviso('No se pudo conectar con el servidor.');
        }
    });

    acciones.appendChild(btnComentar);
    acciones.appendChild(btnRepostear);
    acciones.appendChild(btnLike);
    return acciones;
}

// Fecha completa (día, mes, año y hora) para el detalle del post
function formatearFechaCompleta(fechaBD) {
    if (!fechaBD) return '';
    let fechaLimpia = fechaBD;
    if (typeof fechaBD === 'string' && !fechaBD.endsWith('Z') && !fechaBD.includes('+')) {
        fechaLimpia = fechaBD.replace(' ', 'T') + 'Z';
    }
    const fecha = new Date(fechaLimpia);
    return fecha.toLocaleString('es-ES', {
        day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
}

// Bloque reusable de comentarios: lista + formulario para agregar uno nuevo.
// Sirve tanto para comentarios de posts como de reseñas; quien lo use decide
// cómo se envían/eliminan los comentarios y qué pasa después (normalmente,
// recargar todo el detalle para que cuenten y lista queden al día).
// opciones = { enviarComentario(content) => Promise<{ok,error}>,
//              eliminarComentario(id) => Promise<{ok,error}>,
//              alCambiar: () => void }
function crearBloqueComentarios(comentarios, usuarioActual, opciones) {
    const contenedor = document.createElement('div');

    // El campo de comentario se declara acá arriba para que el botón "Responder"
    // de cada comentario (más abajo) pueda precargarlo con el @usuario correcto.
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Escribe un comentario...';
    input.style.cssText = 'flex: 1; padding: 9px 14px; border-radius: 999px; border: 1px solid var(--color-borde); background: var(--color-tarjeta); font-size: 0.85rem; min-width: 0;';

    const listaComentarios = document.createElement('div');
    listaComentarios.style.cssText = 'margin-top: 15px;';

    if (comentarios.length === 0) {
        const p = document.createElement('p');
        p.style.cssText = 'font-size: 0.85rem; color: var(--color-texto-suave);';
        p.textContent = 'Todavía no hay comentarios.';
        listaComentarios.appendChild(p);
    } else {
        comentarios.forEach(c => {
            // Cada comentario: avatar a la izquierda + burbuja con el contenido.
            const div = document.createElement('div');
            div.style.cssText = 'display: flex; gap: 8px; margin-bottom: 10px; align-items: flex-start;';

            const avatarC = document.createElement('div');
            avatarC.textContent = c.username.slice(0, 2).toUpperCase();
            avatarC.style.cssText = 'width: 28px; height: 28px; border-radius: 50%; background: var(--color-navy-oscuro); color: white; display: flex; align-items: center; justify-content: center; font-size: 0.65rem; font-weight: 700; flex-shrink: 0;';

            const burbuja = document.createElement('div');
            burbuja.style.cssText = 'flex: 1; min-width: 0; background: var(--color-tarjeta); border: 1px solid var(--color-borde); border-radius: 9px; padding: 8px 11px;';

            const cabeceraC = document.createElement('div');
            cabeceraC.style.cssText = 'display: flex; align-items: center;';

            const autorC = document.createElement('a');
            autorC.style.cssText = 'font-size: 0.85rem; font-weight: bold; text-decoration: none; color: inherit;';
            autorC.href = `muro.html?usuario=${encodeURIComponent(c.username)}`;
            autorC.textContent = c.username;
            cabeceraC.appendChild(autorC);

            // El botón de eliminar solo aparece en TUS PROPIOS comentarios
            if (usuarioActual && c.username === usuarioActual) {
                const btnBorrarComentario = document.createElement('button');
                btnBorrarComentario.type = 'button';
                btnBorrarComentario.title = 'Eliminar comentario';
                btnBorrarComentario.textContent = '🗑️';
                btnBorrarComentario.style.cssText = 'background: none; border: none; cursor: pointer; margin-left: 6px; font-size: 0.78rem; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0;';
                btnBorrarComentario.addEventListener('click', async () => {
                    if (!(await confirmarAccion('¿Eliminar este comentario?'))) return;
                    try {
                        const resultado = await opciones.eliminarComentario(c.id);
                        if (resultado && resultado.ok) {
                            if (opciones.alCambiar) opciones.alCambiar();
                            else div.remove();
                        } else {
                            mostrarAviso((resultado && resultado.error) || 'No se pudo eliminar el comentario.');
                        }
                    } catch (error) {
                        mostrarAviso('No se pudo conectar con el servidor.');
                    }
                });
                cabeceraC.appendChild(btnBorrarComentario);
            }

            // Botón para responder directo a quien hizo este comentario: precarga
            // "@usuario " en el campo de abajo, así se muestra como respuesta.
            if (usuarioActual) {
                const btnResponder = document.createElement('button');
                btnResponder.type = 'button';
                btnResponder.textContent = 'Responder';
                btnResponder.style.cssText = 'background: none; border: none; cursor: pointer; margin-left: 8px; font-size: 0.75rem; color: var(--color-navy); font-weight: bold;';
                btnResponder.addEventListener('click', () => {
                    input.value = `@${c.username} `;
                    input.focus();
                });
                cabeceraC.appendChild(btnResponder);
            }

            // Si el comentario arranca arrobando a alguien (ej: "@takato genial!"),
            // lo mostramos como una respuesta directa a esa persona (estilo Twitter),
            // en vez de dejar la mención mezclada con el resto del texto.
            const matchRespuesta = c.content.match(/^@(\w+)[,:]?\s*/);
            let textoRestante = c.content;
            if (matchRespuesta) {
                const nombreMencionado = matchRespuesta[1];
                textoRestante = c.content.slice(matchRespuesta[0].length);

                const lineaRespuesta = document.createElement('p');
                lineaRespuesta.style.cssText = 'margin: 4px 0 0 0; font-size: 0.78rem; color: var(--color-texto-suave);';
                const linkMencion = document.createElement('a');
                linkMencion.href = `muro.html?usuario=${encodeURIComponent(nombreMencionado)}`;
                linkMencion.style.cssText = 'color: var(--color-navy); font-weight: bold; text-decoration: none;';
                linkMencion.textContent = '@' + nombreMencionado;
                linkMencion.addEventListener('click', (e) => e.stopPropagation());
                lineaRespuesta.append('Respondiendo a ', linkMencion);
                burbuja.appendChild(cabeceraC);
                burbuja.appendChild(lineaRespuesta);
            } else {
                burbuja.appendChild(cabeceraC);
            }

            const textoC = document.createElement('p');
            textoC.style.cssText = 'margin: 4px 0 0 0; font-size: 0.85rem;';
            textoC.appendChild(renderizarTextoConMenciones(textoRestante));
            burbuja.appendChild(textoC);
            div.appendChild(avatarC);
            div.appendChild(burbuja);
            listaComentarios.appendChild(div);
        });
    }
    contenedor.appendChild(listaComentarios);

    // Formulario para agregar un comentario (el campo `input` ya se declaró
    // más arriba, así los botones "Responder" de cada comentario pueden usarlo)
    const form = document.createElement('form');
    form.style.cssText = 'margin-top: 12px; display: flex; gap: 6px;';
    const btnEnviar = document.createElement('button');
    btnEnviar.type = 'submit';
    btnEnviar.textContent = 'Comentar';
    btnEnviar.style.cssText = 'padding: 9px 16px; border-radius: 999px; border: none; background: var(--color-navy-oscuro); color: white; cursor: pointer; white-space: nowrap; font-size: 0.85rem; font-weight: 600;';

    form.appendChild(input);
    form.appendChild(btnEnviar);
    contenedor.appendChild(form);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const content = input.value.trim();
        if (!content) return;
        try {
            const resultado = await opciones.enviarComentario(content);
            if (resultado && resultado.ok) {
                input.value = '';
                if (opciones.alCambiar) opciones.alCambiar();
            } else {
                mostrarAviso((resultado && resultado.error) || 'No se pudo comentar (¿iniciaste sesión?).');
            }
        } catch (error) {
            mostrarAviso('No se pudo conectar con el servidor.');
        }
    });

    return contenedor;
}

// Abre el detalle de un post (con sus comentarios) dentro de `contenedor`
// (la columna derecha), guardando lo que había antes para poder volver.
async function abrirDetallePost(postId, contenedor) {
    if (contenedor._contenidoOriginal === undefined) {
        contenedor._contenidoOriginal = contenedor.innerHTML;
    }

    contenedor.innerHTML = '<p>Cargando publicación...</p>';

    try {
        const [respPost, respComentarios, usuarioActual] = await Promise.all([
            fetch(`/api/posts/${postId}`),
            fetch(`/api/posts/${postId}/comments`),
            obtenerUsuarioSesion()
        ]);
        const dataPost = await respPost.json();
        const dataComentarios = await respComentarios.json();

        if (!respPost.ok) {
            contenedor.innerHTML = `<p>${dataPost.error || 'No se pudo cargar la publicación.'}</p>`;
            return;
        }

        renderDetallePost(dataPost.post, dataComentarios.comments || [], contenedor, usuarioActual);
    } catch (error) {
        contenedor.innerHTML = '<p>No se pudo conectar con el servidor.</p>';
    }
}

function cerrarDetallePost(contenedor) {
    // Preferimos una función que vuelva a armar el contenido real (con sus
    // listeners funcionando) antes que un simple string de HTML guardado.
    if (typeof contenedor._volverCallback === 'function') {
        contenedor._volverCallback();
    } else {
        contenedor.innerHTML = contenedor._contenidoOriginal || '';
    }
}

function renderDetallePost(post, comentarios, contenedor, usuarioActual) {
    contenedor.innerHTML = '';

    const btnVolver = document.createElement('button');
    btnVolver.type = 'button';
    btnVolver.textContent = '← Volver';
    btnVolver.style.cssText = 'background: none; border: none; color: var(--color-navy-oscuro); cursor: pointer; font-weight: bold; margin-bottom: 12px; font-size: 0.9rem;';
    btnVolver.addEventListener('click', () => cerrarDetallePost(contenedor));
    contenedor.appendChild(btnVolver);

    // Tarjeta del post (sin volver a hacerla clickeable, ya estamos adentro)
    const article = document.createElement('article');
    article.className = 'post-card';

    const avatar = document.createElement('div');
    avatar.className = 'post-avatar';
    avatar.textContent = '✍️';

    const contenido = document.createElement('div');
    contenido.className = 'post-contenido';

    const header = document.createElement('div');
    header.className = 'post-header';
    const autor = document.createElement('a');
    autor.className = 'post-autor';
    autor.href = `muro.html?usuario=${encodeURIComponent(post.username)}`;
    autor.style.cssText = 'text-decoration: none; color: inherit;';
    autor.textContent = post.username;
    header.appendChild(autor);

    const texto = document.createElement('p');
    texto.className = 'post-texto';
    texto.appendChild(renderizarTextoConMenciones(post.content));

    const fecha = document.createElement('p');
    fecha.style.cssText = 'font-size: 0.75rem; color: var(--color-texto-suave); margin: 4px 0 8px 0;';
    fecha.textContent = formatearFechaCompleta(post.created_at);

    contenido.appendChild(header);
    contenido.appendChild(texto);
    contenido.appendChild(fecha);
    contenido.appendChild(crearBarraAcciones(post, () => {})); // ya estamos viendo el detalle

    article.appendChild(avatar);
    article.appendChild(contenido);
    contenedor.appendChild(article);

    contenedor.appendChild(crearBloqueComentarios(comentarios, usuarioActual, {
        enviarComentario: async (content) => {
            const resp = await fetch(`/api/posts/${post.id}/comments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content })
            });
            const data = await resp.json().catch(() => ({}));
            return { ok: resp.ok, error: data.error };
        },
        eliminarComentario: async (id) => {
            const resp = await fetch(`/api/comments/${id}`, { method: 'DELETE' });
            const data = await resp.json().catch(() => ({}));
            return { ok: resp.ok, error: data.error };
        },
        alCambiar: () => abrirDetallePost(post.id, contenedor)
    }));
}

// ==========================================================================
// DETALLE DE UNA RESEÑA (texto completo + comentarios), en la misma lógica
// que el detalle de un post: se puede abrir dentro de un contenedor (ej. la
// columna derecha) o en una página propia (resena.html) seteando antes
// contenedor._volverCallback.
// ==========================================================================

async function abrirDetalleResena(resenaId, contenedor) {
    if (contenedor._contenidoOriginal === undefined) {
        contenedor._contenidoOriginal = contenedor.innerHTML;
    }

    contenedor.innerHTML = '<p>Cargando reseña...</p>';

    try {
        const [respResena, respComentarios, usuarioActual] = await Promise.all([
            fetch(`/api/reviews/${resenaId}`),
            fetch(`/api/reviews/${resenaId}/comments`),
            obtenerUsuarioSesion()
        ]);
        const dataResena = await respResena.json();
        const dataComentarios = await respComentarios.json().catch(() => ({ comments: [] }));

        if (!respResena.ok) {
            contenedor.innerHTML = `<p>${dataResena.error || 'No se pudo cargar la reseña.'}</p>`;
            return;
        }

        renderDetalleResena(dataResena.review, dataComentarios.comments || [], contenedor, usuarioActual);
    } catch (error) {
        contenedor.innerHTML = '<p>No se pudo conectar con el servidor.</p>';
    }
}

function renderDetalleResena(resena, comentarios, contenedor, usuarioActual) {
    contenedor.innerHTML = '';

    const btnVolver = document.createElement('button');
    btnVolver.type = 'button';
    btnVolver.textContent = '← Volver';
    btnVolver.style.cssText = 'background: none; border: none; color: var(--color-navy-oscuro); cursor: pointer; font-weight: bold; margin-bottom: 12px; font-size: 0.9rem;';
    btnVolver.addEventListener('click', () => cerrarDetallePost(contenedor));
    contenedor.appendChild(btnVolver);

    const tarjeta = document.createElement('div');
    tarjeta.style.cssText = 'display: flex; gap: 14px;';

    const img = document.createElement('img');
    img.src = resena.portada_url || 'https://via.placeholder.com/120x170';
    img.alt = `Portada de ${resena.libro_titulo}`;
    img.style.cssText = 'width: 110px; height: 156px; object-fit: cover; border-radius: 6px; flex-shrink: 0; box-shadow: 0 2px 6px rgba(58,50,38,0.25);';
    tarjeta.appendChild(img);

    const info = document.createElement('div');
    info.style.cssText = 'flex: 1; min-width: 0;';

    const h2 = document.createElement('h2');
    h2.style.cssText = 'font-size: 1.15rem; margin-bottom: 4px; border: none; padding: 0;';
    h2.appendChild(crearLinkLibro(resena.libro_titulo, resena.autor, resena.portada_url));
    info.appendChild(h2);

    const autorP = document.createElement('p');
    autorP.style.cssText = 'font-size: 0.85rem; color: var(--color-texto-suave); margin-bottom: 6px;';
    autorP.textContent = resena.autor;
    info.appendChild(autorP);

    const valoracionP = document.createElement('p');
    valoracionP.className = 'valoracion';
    valoracionP.appendChild(crearEstrellas(resena.valoracion));
    info.appendChild(valoracionP);

    const porP = document.createElement('p');
    porP.style.cssText = 'font-size: 0.8rem; color: var(--color-texto-suave); margin: 4px 0 4px 0;';
    const linkUsuario = document.createElement('a');
    linkUsuario.href = `muro.html?usuario=${encodeURIComponent(resena.username)}`;
    linkUsuario.style.cssText = 'text-decoration: none; color: inherit; font-weight: bold;';
    linkUsuario.textContent = resena.username;
    porP.append('Reseñado por ', linkUsuario);
    info.appendChild(porP);

    const fecha = document.createElement('p');
    fecha.style.cssText = 'font-size: 0.75rem; color: var(--color-texto-suave); margin-bottom: 8px;';
    fecha.textContent = formatearFechaCompleta(resena.created_at);
    info.appendChild(fecha);

    // Acciones: like / dislike (idénticas a la tarjeta chica) + eliminar si es tuya
    const acciones = document.createElement('div');
    acciones.style.cssText = 'display: flex; gap: 10px; align-items: center; margin-bottom: 10px;';

    const btnLike = document.createElement('button');
    btnLike.type = 'button';
    btnLike.textContent = `👍 ${resena.likes_count || 0}`;
    btnLike.style.cssText = 'background: none; border: none; cursor: pointer; font-size: 0.85rem;';
    if (resena.mi_reaccion === 'like') btnLike.style.color = '#198754';

    const btnDislike = document.createElement('button');
    btnDislike.type = 'button';
    btnDislike.textContent = `👎 ${resena.dislikes_count || 0}`;
    btnDislike.style.cssText = 'background: none; border: none; cursor: pointer; font-size: 0.85rem;';
    if (resena.mi_reaccion === 'dislike') btnDislike.style.color = '#e63946';

    async function reaccionar(tipo) {
        try {
            const resp = await fetch(`/api/reviews/${resena.id}/reaccionar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tipo })
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok) {
                mostrarAviso(data.error || 'Debes iniciar sesión para reaccionar.');
                return;
            }
            resena.likes_count = data.likes_count;
            resena.dislikes_count = data.dislikes_count;
            resena.mi_reaccion = data.mi_reaccion;
            btnLike.textContent = `👍 ${data.likes_count}`;
            btnDislike.textContent = `👎 ${data.dislikes_count}`;
            btnLike.style.color = data.mi_reaccion === 'like' ? '#198754' : '';
            btnDislike.style.color = data.mi_reaccion === 'dislike' ? '#e63946' : '';
        } catch (error) {
            mostrarAviso('No se pudo conectar con el servidor.');
        }
    }
    btnLike.addEventListener('click', () => reaccionar('like'));
    btnDislike.addEventListener('click', () => reaccionar('dislike'));

    acciones.appendChild(btnLike);
    acciones.appendChild(btnDislike);

    if (usuarioActual && usuarioActual === resena.username) {
        const btnEliminar = document.createElement('button');
        btnEliminar.type = 'button';
        btnEliminar.title = 'Eliminar reseña';
        btnEliminar.textContent = '🗑️ Eliminar reseña';
        btnEliminar.style.cssText = 'background: none; border: none; cursor: pointer; font-size: 0.8rem; color: #c17b83; margin-left: auto;';
        btnEliminar.addEventListener('click', async () => {
            if (!(await confirmarAccion('¿Eliminar esta reseña?'))) return;
            try {
                const resp = await fetch(`/api/reviews/${resena.id}`, { method: 'DELETE' });
                if (resp.ok) {
                    // Si estamos en la página propia de la reseña, volvemos al muro;
                    // si es un panel dentro de otra página, simplemente lo cerramos.
                    if (window.location.pathname.endsWith('resena.html')) {
                        window.location.href = 'muro.html';
                    } else {
                        cerrarDetallePost(contenedor);
                    }
                } else {
                    const data = await resp.json().catch(() => ({}));
                    mostrarAviso(data.error || 'No se pudo eliminar la reseña.');
                }
            } catch (error) {
                mostrarAviso('No se pudo conectar con el servidor.');
            }
        });
        acciones.appendChild(btnEliminar);
    }
    info.appendChild(acciones);

    // Texto completo de la reseña
    if (resena.texto && resena.texto.trim()) {
        const textoP = document.createElement('p');
        textoP.style.cssText = 'font-size: 0.92rem; white-space: pre-wrap; line-height: 1.5; margin-top: 6px;';
        textoP.appendChild(renderizarTextoConMenciones(resena.texto));
        info.appendChild(textoP);
    }

    tarjeta.appendChild(info);
    contenedor.appendChild(tarjeta);

    const divisor = document.createElement('div');
    divisor.className = 'divisor-lomo';
    contenedor.appendChild(divisor);

    const tituloComentarios = document.createElement('h3');
    tituloComentarios.style.cssText = 'font-size: 1rem; margin-bottom: 6px;';
    tituloComentarios.textContent = 'Comentarios';
    contenedor.appendChild(tituloComentarios);

    contenedor.appendChild(crearBloqueComentarios(comentarios, usuarioActual, {
        enviarComentario: async (content) => {
            const resp = await fetch(`/api/reviews/${resena.id}/comments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content })
            });
            const data = await resp.json().catch(() => ({}));
            return { ok: resp.ok, error: data.error };
        },
        eliminarComentario: async (id) => {
            const resp = await fetch(`/api/review-comments/${id}`, { method: 'DELETE' });
            const data = await resp.json().catch(() => ({}));
            return { ok: resp.ok, error: data.error };
        },
        alCambiar: () => abrirDetalleResena(resena.id, contenedor)
    }));
}
