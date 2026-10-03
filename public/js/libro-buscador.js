// libro-buscador.js
// Autocompletado de libros reales usando Open Library (API pública y gratuita
// de libros, sin API key: https://openlibrary.org/developers/api), a través
// del proxy /api/libros/buscar de nuestro propio servidor.
//
// Se engancha al input de "título": mientras la persona escribe, muestra una
// lista desplegable con portada, título, autor y año. Al elegir un resultado,
// rellena automáticamente los inputs de autor / portada / páginas (los que
// se hayan pasado). Se usa en: agregar libro a una estantería, empezar una
// lectura y publicar una reseña.
//
// Uso: activarBuscadorLibro({ inputTitulo, inputAutor, inputPortada, inputPaginas })
// (inputAutor, inputPortada e inputPaginas son opcionales)
function activarBuscadorLibro({ inputTitulo, inputAutor, inputPortada, inputPaginas }) {
    if (!inputTitulo) return;

    // Envolvemos el input de título en un contenedor propio (position: relative)
    // para poder ubicar la lista de sugerencias justo debajo, sin tocar el resto
    // del formulario.
    const envoltorio = document.createElement('div');
    envoltorio.style.cssText = 'position: relative;';
    inputTitulo.parentNode.insertBefore(envoltorio, inputTitulo);
    envoltorio.appendChild(inputTitulo);

    const lista = document.createElement('div');
    lista.style.cssText = 'display: none; position: absolute; top: 100%; left: 0; right: 0; background: white; border: 1px solid var(--color-borde); border-radius: 6px; box-shadow: 0 4px 10px rgba(0,0,0,0.18); max-height: 260px; overflow-y: auto; z-index: 80; margin-top: 2px;';
    envoltorio.appendChild(lista);

    let temporizador = null;
    let controlador = null;

    function ocultar() {
        lista.style.display = 'none';
        lista.innerHTML = '';
    }

    function pintarResultados(resultados) {
        lista.innerHTML = '';
        if (!resultados || resultados.length === 0) {
            ocultar();
            return;
        }
        resultados.forEach(libro => {
            const item = document.createElement('div');
            item.style.cssText = 'display: flex; gap: 8px; align-items: center; padding: 6px 8px; cursor: pointer; border-bottom: 1px solid var(--color-borde);';
            item.addEventListener('mouseenter', () => { item.style.background = 'var(--color-borde)'; });
            item.addEventListener('mouseleave', () => { item.style.background = 'white'; });

            const img = document.createElement('img');
            img.src = libro.portada_url || 'https://via.placeholder.com/28x40?text=%20';
            img.alt = '';
            img.style.cssText = 'width: 26px; height: 38px; object-fit: cover; border-radius: 2px; flex-shrink: 0; background: var(--color-borde);';
            item.appendChild(img);

            const info = document.createElement('div');
            info.style.cssText = 'min-width: 0;';
            const t = document.createElement('div');
            t.style.cssText = 'font-size: 0.82rem; font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
            t.textContent = libro.titulo;
            const a = document.createElement('div');
            a.style.cssText = 'font-size: 0.75rem; color: var(--color-texto-suave); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
            a.textContent = libro.anio ? `${libro.autor} · ${libro.anio}` : libro.autor;
            info.appendChild(t);
            info.appendChild(a);
            item.appendChild(info);

            item.addEventListener('click', () => {
                inputTitulo.value = libro.titulo || '';
                if (inputAutor) inputAutor.value = libro.autor || '';
                if (inputPortada) inputPortada.value = libro.portada_url || '';
                if (inputPaginas && libro.paginas) inputPaginas.value = libro.paginas;
                ocultar();
            });

            lista.appendChild(item);
        });
        lista.style.display = 'block';
    }

    async function buscar(q) {
        if (controlador) controlador.abort();
        controlador = new AbortController();
        try {
            const resp = await fetch(`/api/libros/buscar?q=${encodeURIComponent(q)}`, { signal: controlador.signal });
            if (!resp.ok) { ocultar(); return; }
            const data = await resp.json();
            pintarResultados(data.resultados);
        } catch (error) {
            if (error.name !== 'AbortError') ocultar();
        }
    }

    inputTitulo.setAttribute('autocomplete', 'off');
    inputTitulo.addEventListener('input', () => {
        const q = inputTitulo.value.trim();
        clearTimeout(temporizador);
        if (q.length < 3) { ocultar(); return; }
        temporizador = setTimeout(() => buscar(q), 350);
    });

    inputTitulo.addEventListener('focus', () => {
        if (inputTitulo.value.trim().length >= 3 && lista.innerHTML !== '') {
            lista.style.display = 'block';
        }
    });

    document.addEventListener('click', (e) => {
        if (!envoltorio.contains(e.target)) ocultar();
    });
}

// Autocompletado para un campo de UN SOLO NOMBRE (el "tag" al postear una
// opinión: puede ser un libro, un autor o una editorial). A diferencia de
// activarBuscadorLibro (que llena varios campos con los datos de un libro),
// acá cada resultado de Open Library se muestra como hasta 3 opciones
// separadas — 📖 Libro / ✍️ Autor / 🏢 Editorial — y al elegir una se deja
// SOLO ese nombre en el input, nada más.
//
// Uso: activarBuscadorTag(inputTag)
function activarBuscadorTag(inputTag) {
    if (!inputTag) return;

    const envoltorio = document.createElement('div');
    envoltorio.style.cssText = 'position: relative;';
    inputTag.parentNode.insertBefore(envoltorio, inputTag);
    envoltorio.appendChild(inputTag);

    const lista = document.createElement('div');
    lista.style.cssText = 'display: none; position: absolute; top: 100%; left: 0; right: 0; background: white; border: 1px solid var(--color-borde); border-radius: 6px; box-shadow: 0 4px 10px rgba(0,0,0,0.18); max-height: 260px; overflow-y: auto; z-index: 80; margin-top: 2px;';
    envoltorio.appendChild(lista);

    let temporizador = null;
    let controlador = null;

    function ocultar() {
        lista.style.display = 'none';
        lista.innerHTML = '';
    }

    function opcion(icono, etiqueta, valor) {
        const item = document.createElement('div');
        item.style.cssText = 'display: flex; gap: 8px; align-items: center; padding: 6px 8px; cursor: pointer; border-bottom: 1px solid var(--color-borde); font-size: 0.82rem;';
        item.addEventListener('mouseenter', () => { item.style.background = 'var(--color-borde)'; });
        item.addEventListener('mouseleave', () => { item.style.background = 'white'; });

        const pre = document.createElement('span');
        pre.textContent = icono;
        item.appendChild(pre);

        const texto = document.createElement('span');
        texto.style.cssText = 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
        texto.textContent = etiqueta;
        item.appendChild(texto);

        item.addEventListener('click', () => {
            inputTag.value = valor;
            ocultar();
            inputTag.focus();
        });
        return item;
    }

    function pintarResultados(resultados) {
        lista.innerHTML = '';
        if (!resultados || resultados.length === 0) {
            ocultar();
            return;
        }

        // Evitamos repetir el mismo nombre de autor/editorial varias veces
        // si aparece en más de un resultado.
        const vistos = new Set();
        resultados.forEach(libro => {
            if (libro.titulo && !vistos.has('L:' + libro.titulo)) {
                vistos.add('L:' + libro.titulo);
                lista.appendChild(opcion('📖', libro.titulo, libro.titulo));
            }
            if (libro.autor && libro.autor !== 'Autor desconocido' && !vistos.has('A:' + libro.autor)) {
                vistos.add('A:' + libro.autor);
                lista.appendChild(opcion('✍️', libro.autor, libro.autor));
            }
            if (libro.editorial && !vistos.has('E:' + libro.editorial)) {
                vistos.add('E:' + libro.editorial);
                lista.appendChild(opcion('🏢', libro.editorial, libro.editorial));
            }
        });

        lista.style.display = lista.innerHTML ? 'block' : 'none';
    }

    async function buscar(q) {
        if (controlador) controlador.abort();
        controlador = new AbortController();
        try {
            const resp = await fetch(`/api/libros/buscar?q=${encodeURIComponent(q)}`, { signal: controlador.signal });
            if (!resp.ok) { ocultar(); return; }
            const data = await resp.json();
            pintarResultados(data.resultados);
        } catch (error) {
            if (error.name !== 'AbortError') ocultar();
        }
    }

    inputTag.setAttribute('autocomplete', 'off');
    inputTag.addEventListener('input', () => {
        const q = inputTag.value.trim();
        clearTimeout(temporizador);
        if (q.length < 3) { ocultar(); return; }
        temporizador = setTimeout(() => buscar(q), 350);
    });

    inputTag.addEventListener('focus', () => {
        if (inputTag.value.trim().length >= 3 && lista.innerHTML !== '') {
            lista.style.display = 'block';
        }
    });

    document.addEventListener('click', (e) => {
        if (!envoltorio.contains(e.target)) ocultar();
    });
}
