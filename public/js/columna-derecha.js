// columna-derecha.js
// Arma el estado "normal" de la columna derecha: Reseñas Recientes + Trending
// (los tags más usados en los posts). Expone cargarColumnaDerecha(contenedor),
// que además deja guardada una forma de "volver" a este estado después de ver
// el detalle de un post (ver posts-comunes.js).

function crearEstrellas(valoracion) {
    const val = Number(valoracion) || 0;
    return '★'.repeat(val) + '☆'.repeat(5 - val);
}

function crearResenaCard(resena, completo) {
    const div = document.createElement('div');
    div.className = 'resena-card';

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
    porP.append('Reseñado por ', linkUsuario);
    info.appendChild(porP);

    // Botones de like / dislike (una sola reacción por persona, se puede cambiar)
    const acciones = document.createElement('div');
    acciones.style.cssText = 'display: flex; gap: 10px;';

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

    btnLike.addEventListener('click', () => reaccionar('like'));
    btnDislike.addEventListener('click', () => reaccionar('dislike'));

    acciones.appendChild(btnLike);
    acciones.appendChild(btnDislike);
    info.appendChild(acciones);

    // Texto de la reseña (opcional): va DEBAJO de los likes/dislikes. Si no
    // alcanza en el espacio chico de la tarjeta, se corta y se ofrece un link
    // a la página dedicada de esa reseña con el texto completo.
    if (resena.texto && resena.texto.trim()) {
        const LIMITE = 220;
        const textoCompleto = resena.texto.trim();
        const textoP = document.createElement('p');
        textoP.style.cssText = 'font-size: 0.85rem; color: #333; margin: 8px 0 0 0; white-space: pre-wrap;';

        if (!completo && textoCompleto.length > LIMITE) {
            textoP.textContent = textoCompleto.slice(0, LIMITE).trim() + '… ';
            const link = document.createElement('a');
            link.href = `resena.html?id=${resena.id}`;
            link.textContent = 'Leer reseña completa';
            link.style.cssText = 'color: #34517c; font-weight: bold; text-decoration: none; white-space: nowrap;';
            textoP.appendChild(link);
        } else {
            textoP.textContent = textoCompleto;
        }
        info.appendChild(textoP);
    }

    div.appendChild(info);
    return div;
}

async function cargarResenasRecientes(contenedor) {
    contenedor.innerHTML = '<p style="font-size:0.85rem;color:#888;">Cargando...</p>';
    try {
        const resp = await fetch('/api/reviews');
        const data = await resp.json();
        contenedor.innerHTML = '';
        if (!data.reviews || data.reviews.length === 0) {
            contenedor.innerHTML = '';
            contenedor.appendChild(crearEstadoVacio('Todavía no hay reseñas.'));
            return;
        }
        data.reviews.forEach(r => contenedor.appendChild(crearResenaCard(r)));
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
