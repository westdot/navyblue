// columna-derecha.js
// Arma el estado "normal" de la columna derecha: Reseñas Recientes + Trending
// (los tags más usados en los posts). Expone cargarColumnaDerecha(contenedor),
// que además deja guardada una forma de "volver" a este estado después de ver
// el detalle de un post (ver posts-comunes.js).

// Devuelve un elemento con las 5 estrellas, admitiendo medias estrellas
// (1, 1.5, 2, 2.5 ... 5). Se dibuja superponiendo una fila de estrellas
// llenas sobre una fila de estrellas vacías, recortando la fila llena al
// porcentaje que corresponda (ej: 3.5 de 5 -> 70% de ancho visible).
function crearEstrellas(valoracion) {
    const val = Math.max(0, Math.min(5, Number(valoracion) || 0));
    const porcentaje = (val / 5) * 100;

    const contenedor = document.createElement('span');
    contenedor.className = 'estrellas-rating';
    contenedor.title = `${val} de 5 estrellas`;

    const vacias = document.createElement('span');
    vacias.className = 'estrellas-base';
    vacias.textContent = '☆☆☆☆☆';

    const llenas = document.createElement('span');
    llenas.className = 'estrellas-llenas';
    llenas.style.width = porcentaje + '%';
    llenas.textContent = '★★★★★';

    contenedor.appendChild(vacias);
    contenedor.appendChild(llenas);
    return contenedor;
}

// Cuánto texto de la reseña mostramos en la tarjeta completa (perfil/detalle)
// antes de recortarlo y mandar a la página propia de la reseña.
const LARGO_MAX_RESENA_CARD = 140;

// `compacta`: se usa solo en "Reseñas Recientes" del index (la barra lateral),
// donde necesitamos que las tarjetas midan siempre lo mismo (portada chica,
// título de una sola línea, sin el texto de la reseña) para que entren 3 y
// el Trending quede visible debajo sin tener que scrollear.
function crearResenaCard(resena, miUsername, compacta) {
    const div = document.createElement('div');
    div.className = 'resena-card';
    if (compacta) div.classList.add('resena-card-compacta');
    div.style.cursor = 'pointer';
    div.title = 'Abrir esta reseña';

    const img = document.createElement('img');
    img.src = resena.portada_url || 'https://via.placeholder.com/100x140';
    img.alt = `Portada de ${resena.libro_titulo}`;
    if (compacta) img.style.cssText = 'width: 52px; height: 74px; flex-shrink: 0;';
    div.appendChild(img);

    const info = document.createElement('div');
    info.className = 'resena-info';
    if (compacta) info.style.cssText = 'min-width: 0;';

    const h3 = document.createElement('h3');
    h3.textContent = resena.libro_titulo;
    if (compacta) h3.style.cssText = 'font-size: 0.85rem; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
    info.appendChild(h3);

    const autorP = document.createElement('p');
    autorP.style.cssText = compacta
        ? 'font-size: 0.72rem; color: #666; margin: 0 0 2px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;'
        : 'font-size: 0.8rem; color: #666; margin: 2px 0;';
    autorP.textContent = resena.autor;
    info.appendChild(autorP);

    const valoracionP = document.createElement('p');
    valoracionP.className = 'valoracion';
    if (compacta) valoracionP.style.cssText = 'font-size: 0.78rem; margin: 0;';
    if (!compacta) valoracionP.append('Valoración: ');
    valoracionP.appendChild(crearEstrellas(resena.valoracion));
    info.appendChild(valoracionP);

    // Cuando la tarjeta viene de "Reseñas Recientes" agrupada por libro
    // (ver /api/reviews/top), mostramos cuántas reseñas tiene ese libro en
    // total en vez de que aparezca repetido varias veces.
    if (resena.total_resenas && resena.total_resenas > 1) {
        const totalP = document.createElement('p');
        totalP.style.cssText = compacta
            ? 'font-size: 0.68rem; color: #888; margin: 1px 0 0 0; font-weight: bold;'
            : 'font-size: 0.75rem; color: #888; margin: 2px 0; font-weight: bold;';
        totalP.textContent = `${resena.total_resenas} reseñas`;
        info.appendChild(totalP);
    }

    const porP = document.createElement('p');
    porP.style.cssText = compacta
        ? 'font-size: 0.7rem; color: #888; margin: 2px 0 4px 0;'
        : 'font-size: 0.75rem; color: #888; margin: 2px 0 6px 0;';
    const linkUsuario = document.createElement('a');
    linkUsuario.href = `muro.html?usuario=${encodeURIComponent(resena.username)}`;
    linkUsuario.style.cssText = 'text-decoration: none; color: inherit; font-weight: bold;';
    linkUsuario.textContent = resena.username;
    linkUsuario.addEventListener('click', (e) => e.stopPropagation());
    porP.append(compacta ? '' : 'Reseñado por ', linkUsuario);
    info.appendChild(porP);

    // Botones de like / dislike (una sola reacción por persona, se puede cambiar)
    const acciones = document.createElement('div');
    acciones.style.cssText = compacta
        ? 'display: flex; gap: 8px; align-items: center;'
        : 'display: flex; gap: 10px; align-items: center;';

    const btnLike = document.createElement('button');
    btnLike.type = 'button';
    btnLike.textContent = `👍 ${resena.likes_count || 0}`;
    btnLike.style.cssText = `background: none; border: none; cursor: pointer; font-size: ${compacta ? '0.72rem' : '0.8rem'};`;
    if (resena.mi_reaccion === 'like') btnLike.style.color = '#198754';

    const btnDislike = document.createElement('button');
    btnDislike.type = 'button';
    btnDislike.textContent = `👎 ${resena.dislikes_count || 0}`;
    btnDislike.style.cssText = `background: none; border: none; cursor: pointer; font-size: ${compacta ? '0.72rem' : '0.8rem'};`;
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
        btnEliminar.style.cssText = `background: none; border: none; cursor: pointer; font-size: ${compacta ? '0.72rem' : '0.8rem'}; margin-left: auto;`;
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

    // Debajo de los likes: el texto escrito de la reseña (si tiene). En la
    // versión compacta (barra lateral del index) lo omitimos por completo
    // para que las 3 tarjetas midan siempre lo mismo; el texto completo se
    // lee entrando a la reseña. En la versión normal, si no cabe en el
    // espacio de la tarjeta, se recorta y se ofrece un link a la página
    // completa de la reseña, donde además se puede comentar.
    if (!compacta && resena.texto && resena.texto.trim()) {
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
        // Top 3 de libros con más reseñas (agrupado, no reseñas sueltas)
        const [resp, miUsername] = await Promise.all([
            fetch('/api/reviews/top'),
            obtenerUsuarioSesion()
        ]);
        const data = await resp.json();
        contenedor.innerHTML = '';
        if (!data.reviews || data.reviews.length === 0) {
            contenedor.innerHTML = '';
            contenedor.appendChild(crearEstadoVacio('Todavía no hay reseñas.'));
            return;
        }
        data.reviews.forEach(r => contenedor.appendChild(crearResenaCard(r, miUsername, true)));
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
