// composer-comun.js
// Caja para publicar, con dos pestañas TOTALMENTE separadas: "Postear" (opinión
// libre, como hasta ahora) y "Reseñar" (libro + autor + portada + valoración,
// sin texto de opinión). Reutilizable en index.html y muro.html.
//
// onPost() se llama después de publicar un post (para refrescar el feed).
// onResena() se llama después de publicar una reseña (para refrescar la
// columna derecha).
function crearComposer({ onPost, onResena } = {}) {
    const contenedor = document.createElement('div');
    contenedor.className = 'publicar-box';

    // --- Pestañas para elegir Postear / Reseñar ---
    const tabs = document.createElement('div');
    tabs.style.cssText = 'display: flex; gap: 0; margin-bottom: 10px; border: 1px solid #ccc; border-radius: 6px; overflow: hidden;';

    const btnTabPost = document.createElement('button');
    btnTabPost.type = 'button';
    btnTabPost.textContent = 'Postear';
    btnTabPost.style.cssText = 'flex: 1; padding: 8px; border: none; cursor: pointer; background: #34517c; color: white;';

    const btnTabResena = document.createElement('button');
    btnTabResena.type = 'button';
    btnTabResena.textContent = 'Reseñar';
    btnTabResena.style.cssText = 'flex: 1; padding: 8px; border: none; cursor: pointer; background: #eee; color: #333;';

    tabs.appendChild(btnTabPost);
    tabs.appendChild(btnTabResena);
    contenedor.appendChild(tabs);

    // --- Formulario de POST (opinión libre, funcionalidad de siempre) ---
    const formPost = document.createElement('div');

    const textarea = document.createElement('textarea');
    textarea.placeholder = '¿Qué libro estás leyendo o qué opinas hoy?';

    const footerPost = document.createElement('div');
    footerPost.style.cssText = 'display: flex; gap: 10px; align-items: center; margin-top: 10px;';

    const inputTag = document.createElement('input');
    inputTag.type = 'text';
    inputTag.placeholder = 'Ej: Libro, Autor, Editorial...';
    inputTag.style.cssText = 'padding: 5px; border-radius: 4px; border: 1px solid #ccc;';

    const btnPublicarPost = document.createElement('button');
    btnPublicarPost.type = 'button';
    btnPublicarPost.className = 'btn-publicar';
    btnPublicarPost.textContent = 'Publicar';
    btnPublicarPost.style.cursor = 'pointer';

    const mensajePost = document.createElement('p');
    mensajePost.style.cssText = 'font-size: 12px; margin-top: 5px;';

    footerPost.appendChild(inputTag);
    footerPost.appendChild(btnPublicarPost);
    formPost.appendChild(textarea);
    formPost.appendChild(footerPost);
    formPost.appendChild(mensajePost);

    // Autocompletado con libros/autores/editoriales reales (Open Library),
    // dejando solo el nombre elegido en el campo.
    if (typeof activarBuscadorTag === 'function') {
        activarBuscadorTag(inputTag);
    }

    // Enter para publicar: en el texto, Enter publica y Shift+Enter hace un
    // salto de línea normal; en el campo de tag, Enter publica directo.
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            btnPublicarPost.click();
        }
    });
    inputTag.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            btnPublicarPost.click();
        }
    });

    btnPublicarPost.addEventListener('click', async () => {
        const content = textarea.value.trim();
        const tag = inputTag.value.trim();

        if (!content) {
            mensajePost.style.color = 'red';
            mensajePost.textContent = 'Escribe algo antes de publicar.';
            return;
        }

        try {
            const resp = await fetch('/api/posts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content, tag })
            });
            const data = await resp.json().catch(() => ({}));

            if (!resp.ok) {
                mensajePost.style.color = 'red';
                mensajePost.textContent = data.error || 'No se pudo publicar.';
                return;
            }

            textarea.value = '';
            inputTag.value = '';
            mensajePost.style.color = 'green';
            mensajePost.textContent = '¡Publicado con éxito!';
            if (onPost) onPost();
        } catch (error) {
            mensajePost.style.color = 'red';
            mensajePost.textContent = 'No se pudo conectar con el servidor.';
        }
    });

    // --- Formulario de RESEÑA (funcionalidad nueva, separada) ---
    const formResena = document.createElement('div');
    formResena.style.display = 'none';

    function campoTexto(placeholder) {
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = placeholder;
        input.style.cssText = 'width: 100%; padding: 8px; margin-bottom: 8px; border-radius: 4px; border: 1px solid #ccc; box-sizing: border-box;';
        return input;
    }

    const inputTitulo = campoTexto('Título del libro');
    const inputAutor = campoTexto('Autor');
    const inputPortada = campoTexto('URL de la portada (opcional)');

    const labelEstrellas = document.createElement('p');
    labelEstrellas.style.cssText = 'font-size: 0.8rem; color: #666; margin: 0 0 4px 0;';
    labelEstrellas.textContent = 'Tu valoración:';

    const selectorEstrellas = document.createElement('div');
    selectorEstrellas.style.cssText = 'margin-bottom: 10px; font-size: 1.4rem;';
    let valoracionElegida = 0;
    const estrellasSpans = [];
    for (let i = 1; i <= 5; i++) {
        const span = document.createElement('span');
        span.textContent = '☆';
        span.style.cssText = 'cursor: pointer; margin-right: 2px;';
        span.addEventListener('click', () => {
            valoracionElegida = i;
            estrellasSpans.forEach((s, idx) => { s.textContent = idx < valoracionElegida ? '★' : '☆'; });
        });
        estrellasSpans.push(span);
        selectorEstrellas.appendChild(span);
    }

    const btnPublicarResena = document.createElement('button');
    btnPublicarResena.type = 'button';
    btnPublicarResena.className = 'btn-publicar';
    btnPublicarResena.textContent = 'Publicar Reseña';
    btnPublicarResena.style.cursor = 'pointer';

    const mensajeResena = document.createElement('p');
    mensajeResena.style.cssText = 'font-size: 12px; margin-top: 5px;';

    formResena.appendChild(inputTitulo);
    formResena.appendChild(inputAutor);
    formResena.appendChild(inputPortada);
    formResena.appendChild(labelEstrellas);
    formResena.appendChild(selectorEstrellas);
    formResena.appendChild(btnPublicarResena);
    formResena.appendChild(mensajeResena);

    // Autocompletado con datos de libros reales (Open Library)
    if (typeof activarBuscadorLibro === 'function') {
        activarBuscadorLibro({ inputTitulo, inputAutor, inputPortada });
    }

    // Enter en cualquiera de los 3 campos también publica la reseña
    [inputTitulo, inputAutor, inputPortada].forEach(input => {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                btnPublicarResena.click();
            }
        });
    });

    btnPublicarResena.addEventListener('click', async () => {
        const libro_titulo = inputTitulo.value.trim();
        const autor = inputAutor.value.trim();
        const portada_url = inputPortada.value.trim();

        if (!libro_titulo || !autor || valoracionElegida === 0) {
            mensajeResena.style.color = 'red';
            mensajeResena.textContent = 'Completa título, autor y una valoración.';
            return;
        }

        try {
            const resp = await fetch('/api/reviews', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ libro_titulo, autor, portada_url, valoracion: valoracionElegida })
            });
            const data = await resp.json().catch(() => ({}));

            if (!resp.ok) {
                mensajeResena.style.color = 'red';
                mensajeResena.textContent = data.error || 'No se pudo publicar la reseña.';
                return;
            }

            inputTitulo.value = '';
            inputAutor.value = '';
            inputPortada.value = '';
            valoracionElegida = 0;
            estrellasSpans.forEach(s => { s.textContent = '☆'; });
            mensajeResena.style.color = 'green';
            mensajeResena.textContent = '¡Reseña publicada con éxito!';
            if (onResena) onResena();
        } catch (error) {
            mensajeResena.style.color = 'red';
            mensajeResena.textContent = 'No se pudo conectar con el servidor.';
        }
    });

    contenedor.appendChild(formPost);
    contenedor.appendChild(formResena);

    // --- Cambiar entre pestañas ---
    btnTabPost.addEventListener('click', () => {
        formPost.style.display = '';
        formResena.style.display = 'none';
        btnTabPost.style.background = '#34517c';
        btnTabPost.style.color = 'white';
        btnTabResena.style.background = '#eee';
        btnTabResena.style.color = '#333';
    });
    btnTabResena.addEventListener('click', () => {
        formPost.style.display = 'none';
        formResena.style.display = '';
        btnTabResena.style.background = '#34517c';
        btnTabResena.style.color = 'white';
        btnTabPost.style.background = '#eee';
        btnTabPost.style.color = '#333';
    });

    return contenedor;
}
