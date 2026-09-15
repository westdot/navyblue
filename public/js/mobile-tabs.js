// mobile-tabs.js
// En pantallas angostas, en vez de apilar las 3 columnas una debajo de otra,
// las convierte en pestañas. En pantallas grandes no hace nada (las 3 columnas
// se ven igual que siempre, vía CSS normal).
//
// etiquetas: array de hasta 3 objetos { selector, texto }, en el orden en que
// aparecen las columnas (izquierda, centro, derecha). Si una columna no existe
// en la página, simplemente se omite.
function activarTabsMobile(etiquetas) {
    const contenedor = document.querySelector('.contenedor-principal');
    if (!contenedor) return;

    const columnas = etiquetas
        .map(e => ({ el: document.querySelector(e.selector), texto: e.texto, selector: e.selector }))
        .filter(c => c.el);

    if (columnas.length < 2) return; // no tiene sentido armar pestañas para una sola columna

    const tabs = document.createElement('div');
    tabs.className = 'tabs-mobile';

    function mostrar(indice) {
        columnas.forEach((c, i) => {
            c.el.classList.toggle('col-mobile-activa', i === indice);
        });
        tabs.querySelectorAll('button').forEach((b, i) => {
            b.classList.toggle('activa', i === indice);
        });
    }

    columnas.forEach((c, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = c.texto;
        btn.addEventListener('click', () => mostrar(i));
        tabs.appendChild(btn);
    });

    contenedor.parentNode.insertBefore(tabs, contenedor);

    // Por defecto mostramos la columna central (el feed), si existe; si no, la primera
    const indiceInicial = columnas.findIndex(c => c.selector === '.columna-centro');
    mostrar(indiceInicial >= 0 ? indiceInicial : Math.min(1, columnas.length - 1));
}
