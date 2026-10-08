exports.up = function (knex) {
    return knex.schema.alterTable('courses', (t) => {
        t.text('description');
        t.string('department');
    });
};

exports.down = function (knex) {
    return knex.schema.alterTable('courses', (t) => {
        t.dropColumn('description');
        t.dropColumn('department');
    });
};
