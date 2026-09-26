// Arma la URL de la portada a partir del cover_i que devuelve Open Library.
function portadaOpenLibrary(coverId) {
    return coverId ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg` : null;
}

async function buscarEnOpenLibrary(q, limite = 8) {
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=${limite}&fields=title,author_name,cover_i,first_publish_year,number_of_pages_median,publisher`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'NavyBlue (proyecto personal)' } });
    if (!resp.ok) throw new Error(`Open Library respondió ${resp.status}`);
    const data = await resp.json();
    return (data.docs || []).map(doc => ({
        titulo: doc.title,
        autor: (doc.author_name && doc.author_name[0]) || 'Autor desconocido',
        editorial: (doc.publisher && doc.publisher[0]) || null,
        portada_url: portadaOpenLibrary(doc.cover_i),
        anio: doc.first_publish_year || null,
        paginas: doc.number_of_pages_median || null
    }));
}

// Mapa de códigos de idioma de Open Library (ISO 639-2) a nombres en español
const NOMBRES_IDIOMA = {
    eng: 'Inglés', spa: 'Español', fre: 'Francés', fra: 'Francés', ger: 'Alemán',
    ita: 'Italiano', por: 'Portugués', jpn: 'Japonés', chi: 'Chino', kor: 'Coreano'
};

// Trae datos "de ficha" de un libro puntual (editorial, idioma, páginas,
// categoría, ISBN y sinopsis) buscándolo por título + autor en Open Library.
// Es "best effort": si el libro no aparece o Open Library falla, se devuelve
// null y la página de detalle simplemente no muestra esos campos.
async function buscarDetalleEnOpenLibrary(titulo, autor) {
    const q = autor ? `${titulo} ${autor}` : titulo;
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=1&fields=key,title,author_name,cover_i,first_publish_year,number_of_pages_median,publisher,language,isbn,subject`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'NavyBlue (proyecto personal)' } });
    if (!resp.ok) throw new Error(`Open Library respondió ${resp.status}`);
    const data = await resp.json();
    const doc = (data.docs || [])[0];
    if (!doc) return null;

    // La sinopsis vive en la ficha de la "obra" (work), un segundo llamado
    // usando la key que devuelve la búsqueda (ej: "/works/OL12345W")
    let sinopsis = null;
    if (doc.key) {
        try {
            const respObra = await fetch(`https://openlibrary.org${doc.key}.json`, { headers: { 'User-Agent': 'NavyBlue (proyecto personal)' } });
            if (respObra.ok) {
                const obra = await respObra.json();
                if (obra.description) {
                    sinopsis = typeof obra.description === 'string' ? obra.description : obra.description.value;
                }
            }
        } catch (error) {
            // sin sinopsis, no es grave
        }
    }

    return {
        editorial: (doc.publisher && doc.publisher[0]) || null,
        idioma: (doc.language && (NOMBRES_IDIOMA[doc.language[0]] || doc.language[0])) || null,
        paginas: doc.number_of_pages_median || null,
        categoria: (doc.subject && doc.subject.slice(0, 3).join(', ')) || null,
        isbn: (doc.isbn && doc.isbn[0]) || null,
        anio: doc.first_publish_year || null,
        sinopsis
    };
}

module.exports = { portadaOpenLibrary, buscarEnOpenLibrary, buscarDetalleEnOpenLibrary };
