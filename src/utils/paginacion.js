// --- PAGINACIÓN POR CURSOR (para el scroll infinito) ---
// En vez de "página 1, página 2..." (OFFSET), el frontend pide "los N siguientes
// más viejos que el id X" (?before=X&limit=N). Es más rápido en tablas grandes
// y no se descuadra si mientras tanto alguien publica algo nuevo (con OFFSET,
// un post nuevo empujaría todo una posición y se repetirían elementos).
//
// Cada endpoint pide limit + 1 filas: si llegan N + 1, sabemos que "hay más"
// sin tener que hacer un COUNT aparte, y descartamos la fila sobrante.

const LIMITE_POR_DEFECTO = 20;
const LIMITE_MAXIMO = 50; // tope para que nadie pida ?limit=100000

function leerPaginacion(query, porDefecto = LIMITE_POR_DEFECTO) {
    let limit = parseInt(query.limit, 10);
    if (!limit || limit < 1) limit = porDefecto;
    if (limit > LIMITE_MAXIMO) limit = LIMITE_MAXIMO;

    const before = parseInt(query.before, 10);
    return {
        limit,
        before: Number.isInteger(before) && before > 0 ? before : null
    };
}

// Recibe las filas traídas con LIMIT (limit + 1) y devuelve { filas, hasMore }
function recortarPagina(filas, limit) {
    const hasMore = filas.length > limit;
    return { filas: hasMore ? filas.slice(0, limit) : filas, hasMore };
}

module.exports = { leerPaginacion, recortarPagina, LIMITE_POR_DEFECTO, LIMITE_MAXIMO };
