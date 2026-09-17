// columna-derecha.js
// Arma el estado "normal" de la columna derecha: Reseñas Recientes + Trending
// (los tags más usados en los posts). Expone cargarColumnaDerecha(contenedor),
// que además deja guardada una forma de "volver" a este estado después de ver
// el detalle de un post (ver posts-comunes.js).

function crearEstrellas(valoracion) {
    const val = Number(valoracion) || 0;
    return '★'.repeat(val) + '☆'.repeat(5 - val);
}

// Cuánto texto de la reseña mostramos en la tarjeta chica antes de recortarlo
// y mandar a la página completa de la reseña.
const LARGO_MAX_RESENA_CARD = 140;

function crearResenaCard(resena, miUsername) {
    const div = document.createElement('div');
    div.className = 'resena-card';
    div.style.cursor = 'pointer';
    div.title = 'Abrir esta reseña';

    const img = document.createElement('img');
    img.src = resena.portada_url || 'https://via.placeholder.com/100x140';
    img.alt = `Portada de ${resena.libro_titulo}`;
    div.appendChild(img);

    const info = document.createElement('div');
    info.className = 'resena-info';

    const h3 = document.createElement('h3');
    h3.textContent = resena.libro_titulo;
    info.appendChild(h3);

    const autorP = document.createElement('p');
    autorP.style.cssText = 'font-size: 0.8rem; color: #666; margin: 2px 0;';
    autorP.textContent = resena.autor;
    info.appendChild(autorP);

    const valoracionP = document.createElement('p');
    valoracionP.className = 'valoracion';
    valoracionP.textContent = `Valoración: ${crearEstrellas(resena.valoracion)}`;
    info.appendChild(valoracionP);

    const porP = document.createElement('p');
    porP.style.cssText = 'font-size: 0.75rem; color: #888; margin: 2px 0 6px 0;';
    const linkUsuario = document.createElement('a');
    linkUsuario.href = `muro.html?usuario=${encodeURIComponent(resena.username)}`;
    linkUsuario.style.cssText = 'text-decoration: none; color: inherit; font-weight: bold;';
    linkUsuario.textContent = resena.username;
    linkUsuario.addEventListener('click', (e) => e.stopPropagation());
    porP.append('Reseñado por ', linkUsuario);
    info.appendChild(porP);

    // Botones de like / dislike (una sola reacción por persona, se puede cambiar)
    const acciones = document.createElement('div');
    acciones.style.cssText = 'display: flex; gap: 10px; align-items: center;';

    const btnLike = document.createElement('button');
    btnLike.type = 'button';
    btnLike.textContent = `👍 ${resena.likes_count || 0}`;
    btnLike.style.cssText = 'background: none; border: none; cursor: pointer; font-size: 0.8rem;';
    if (resena.mi_reaccion === 'like') btnLike.style.color = '#198754';

    const btnDislike = document.createElement('button');
    btnDislike.type = 'button';
    btnDislike.textContent = `👎 ${resena.dislikes_count || 0}`;
    btnDislike.style.cssText = 'background: none; border: none; cursor: pointer; font-size: 0.8rem;';
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

    btnLike.addEventListener('click', (e) => { e.stopPropagation(); reaccionar('like'); });
    btnDislike.addEventListener('click', (e) => { e.stopPropagation(); reaccionar('dislike'); });

    acciones.appendChild(btnLike);
    acciones.appendChild(btnDislike);

    // Botón de eliminar: solo aparece en tus propias reseñas
    if (miUsername && miUsername === resena.username) {
        const btnEliminar = document.createElement('button');
        btnEliminar.type = 'button';
        btnEliminar.title = 'Eliminar reseña';
        btnEliminar.textContent = '🗑️';
        btnEliminar.style.cssText = 'background: none; border: none; cursor: pointer; font-size: 0.8rem; margin-left: auto;';
        btnEliminar.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!(await confirmarAccion('¿Eliminar esta reseña?'))) return;
            try {
                const resp = await fetch(`/api/reviews/${resena.id}`, { method: 'DELETE' });
                if (resp.ok) {
                    div.remove();
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

    // Debajo de los likes: el texto escrito de la reseña (si tiene). Si no
    // cabe en el espacio de la tarjeta, se recorta y se ofrece un link a la
    // página completa de la reseña, donde además se puede comentar.
    if (resena.texto && resena.texto.trim()) {
        const textoP = document.createElement('p');
        textoP.style.cssText = 'font-size: 0.82rem; margin-top: 6px; white-space: pre-wrap;';
        const textoCompleto = resena.texto.trim();

        if (textoCompleto.length > LARGO_MAX_RESENA_CARD) {
            textoP.textContent = textoCompleto.slice(0, LARGO_MAX_RESENA_CARD).trim() + '… ';
            const linkCompleta = document.createElement('a');
            linkCompleta.href = `resena.html?id=${resena.id}`;
            linkCompleta.textContent = 'Leer reseña completa';
            linkCompleta.style.cssText = 'color: #5b6f8f; font-weight: bold; text-decoration: none; font-size: 0.8rem;';
            linkCompleta.addEventListener('click', (e) => e.stopPropagation());
            textoP.appendChild(linkCompleta);
        } else {
            textoP.textContent = textoCompleto;
        }
        info.appendChild(textoP);
    }

    div.appendChild(info);

    // Clic en cualquier parte de la tarjeta abre la reseña en su propia página
    // (los botones de arriba ya cortan la propagación, así que no interfieren).
    div.addEventListener('click', () => {
        window.location.href = `resena.html?id=${resena.id}`;
    });

    return div;
}

async function cargarResenasRecientes(contenedor) {
    contenedor.innerHTML = '<p style="font-size:0.85rem;color:#888;">Cargando...</p>';
    try {
        const [resp, miUsername] = await Promise.all([
            fetch('/api/reviews'),
            obtenerUsuarioSesion()
        ]);
        const data = await resp.json();
        contenedor.innerHTML = '';
        if (!data.reviews || data.reviews.length === 0) {
            contenedor.innerHTML = '';
            contenedor.appendChild(crearEstadoVacio('Todavía no hay reseñas.'));
            return;
        }
        data.reviews.forEach(r => contenedor.appendChild(crearResenaCard(r, miUsername)));
    } catch (error) {
        contenedor.innerHTML = '<p style="font-size:0.85rem;color:#888;">No se pudieron cargar las reseñas.</p>';
    }
}

async function cargarTrending(contenedor) {
    contenedor.innerHTML = '<p style="font-size:0.85rem;color:#888;">Cargando...</p>';
    try {
        const resp = await fetch('/api/trending');
        const data = await resp.json();
        contenedor.innerHTML = '';
        if (!data.trending || data.trending.length === 0) {
            contenedor.innerHTML = '';
            contenedor.appendChild(crearEstadoVacio('Todavía no hay temas en tendencia.'));
            return;
        }
        const ol = document.createElement('ol');
        ol.style.cssText = 'padding-left: 18px; margin: 0;';
        data.trending.forEach(t => {
            const li = document.createElement('li');
            li.style.cssText = 'margin-bottom: 6px; font-size: 0.85rem;';
            const strong = document.createElement('strong');
            strong.textContent = `#${t.tag}`;
            li.appendChild(strong);
            li.append(` · ${t.cantidad} publicaci${t.cantidad === 1 ? 'ón' : 'ones'}`);
            ol.appendChild(li);
        });
        contenedor.appendChild(ol);
    } catch (error) {
        contenedor.innerHTML = '<p style="font-size:0.85rem;color:#888;">No se pudo cargar el trending.</p>';
    }
}

// Arma el estado "normal" completo de la columna derecha. Se puede volver a
// llamar en cualquier momento (por ejemplo, después de publicar una reseña,
// o al volver del detalle de un post) para refrescarla con listeners nuevos.
async function cargarColumnaDerecha(contenedor) {
    contenedor.innerHTML = `
        <h2>Reseñas Recientes</h2>
        <div class="lista-resenas"></div>
        <div class="divisor-lomo"></div>
        <h2>Trending</h2>
        <div class="lista-trending"></div>
    `;
    cargarResenasRecientes(contenedor.querySelector('.lista-resenas'));
    cargarTrending(contenedor.querySelector('.lista-trending'));

    // Guardamos cómo volver a este estado: al usar una función (no un string de
    // HTML guardado), el botón "← Volver" del detalle de un post deja todo con
    // sus listeners de like/dislike funcionando de nuevo, no solo el texto.
    contenedor._volverCallback = () => cargarColumnaDerecha(contenedor);
}
