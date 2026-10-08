exports.up = function (knex) {
    return knex.schema.alterTable('courses', (table) => {
        table.integer('teacher_id').references('id').inTable('users');
    });
};

exports.down = function (knex) {
    return knex.schema.alterTable('courses', (table) => {
        table.dropColumn('teacher_id');
    });
};
