// Convierte los contadores 0/1 de SQLite en booleanos reales
function normalizarPost(row) {
    return {
        ...row,
        liked_by_me: !!row.liked_by_me,
        reposted_by_me: !!row.reposted_by_me
    };
}

module.exports = { normalizarPost };
