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
        link.style.cssText = 'color: #5b6f8f; font-weight: bold; text-decoration: none;';
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
    btnVolver.style.cssText = 'background: none; border: none; color: #34517c; cursor: pointer; font-weight: bold; margin-bottom: 12px; font-size: 0.9rem;';
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
    fecha.style.cssText = 'font-size: 0.75rem; color: #888; margin: 4px 0 8px 0;';
    fecha.textContent = formatearFechaCompleta(post.created_at);

    contenido.appendChild(header);
    contenido.appendChild(texto);
    contenido.appendChild(fecha);
    contenido.appendChild(crearBarraAcciones(post, () => {})); // ya estamos viendo el detalle

    article.appendChild(avatar);
    article.appendChild(contenido);
    contenedor.appendChild(article);

    // Lista de comentarios
    const listaComentarios = document.createElement('div');
    listaComentarios.style.cssText = 'margin-top: 15px;';

    if (comentarios.length === 0) {
        const p = document.createElement('p');
        p.style.cssText = 'font-size: 0.85rem; color: #888;';
        p.textContent = 'Todavía no hay comentarios.';
        listaComentarios.appendChild(p);
    } else {
        comentarios.forEach(c => {
            const div = document.createElement('div');
            div.style.cssText = 'border-top: 1px solid #eee; padding: 8px 0;';

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
                btnBorrarComentario.style.cssText = 'background: none; border: none; cursor: pointer; margin-left: 8px; font-size: 0.8rem;';
                btnBorrarComentario.addEventListener('click', async () => {
                    if (!(await confirmarAccion('¿Eliminar este comentario?'))) return;
                    try {
                        const resp = await fetch(`/api/comments/${c.id}`, { method: 'DELETE' });
                        if (resp.ok) {
                            div.remove();
                            if (post.comments_count) post.comments_count--;
                        } else {
                            const data = await resp.json().catch(() => ({}));
                            mostrarAviso(data.error || 'No se pudo eliminar el comentario.');
                        }
                    } catch (error) {
                        mostrarAviso('No se pudo conectar con el servidor.');
                    }
                });
                cabeceraC.appendChild(btnBorrarComentario);
            }

            const textoC = document.createElement('p');
            textoC.style.cssText = 'margin: 4px 0 0 0; font-size: 0.85rem;';
            textoC.appendChild(renderizarTextoConMenciones(c.content));
            div.appendChild(cabeceraC);
            div.appendChild(textoC);
            listaComentarios.appendChild(div);
        });
    }
    contenedor.appendChild(listaComentarios);

    // Formulario para agregar un comentario
    const form = document.createElement('form');
    form.style.cssText = 'margin-top: 12px; display: flex; gap: 6px;';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Escribe un comentario...';
    input.style.cssText = 'flex: 1; padding: 8px; border-radius: 6px; border: 1px solid #ccc; min-width: 0;';
    const btnEnviar = document.createElement('button');
    btnEnviar.type = 'submit';
    btnEnviar.textContent = 'Comentar';
    btnEnviar.style.cssText = 'padding: 8px 12px; border-radius: 6px; border: none; background: #34517c; color: white; cursor: pointer; white-space: nowrap;';

    form.appendChild(input);
    form.appendChild(btnEnviar);
    contenedor.appendChild(form);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const content = input.value.trim();
        if (!content) return;
        try {
            const resp = await fetch(`/api/posts/${post.id}/comments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content })
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok) {
                mostrarAviso(data.error || 'No se pudo comentar (¿iniciaste sesión?).');
                return;
            }
            input.value = '';
            abrirDetallePost(post.id, contenedor); // recarga el detalle con el comentario nuevo
        } catch (error) {
            mostrarAviso('No se pudo conectar con el servidor.');
        }
    });
}
