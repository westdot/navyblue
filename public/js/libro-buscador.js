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
    lista.style.cssText = 'display: none; position: absolute; top: 100%; left: 0; right: 0; background: white; border: 1px solid #ccc; border-radius: 6px; box-shadow: 0 4px 10px rgba(0,0,0,0.18); max-height: 260px; overflow-y: auto; z-index: 80; margin-top: 2px;';
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
            item.style.cssText = 'display: flex; gap: 8px; align-items: center; padding: 6px 8px; cursor: pointer; border-bottom: 1px solid #f0f0f0;';
            item.addEventListener('mouseenter', () => { item.style.background = '#f5f5f5'; });
            item.addEventListener('mouseleave', () => { item.style.background = 'white'; });

            const img = document.createElement('img');
            img.src = libro.portada_url || 'https://via.placeholder.com/28x40?text=%20';
            img.alt = '';
            img.style.cssText = 'width: 26px; height: 38px; object-fit: cover; border-radius: 2px; flex-shrink: 0; background: #eee;';
            item.appendChild(img);

            const info = document.createElement('div');
            info.style.cssText = 'min-width: 0;';
            const t = document.createElement('div');
            t.style.cssText = 'font-size: 0.82rem; font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
            t.textContent = libro.titulo;
            const a = document.createElement('div');
            a.style.cssText = 'font-size: 0.75rem; color: #888; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
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
