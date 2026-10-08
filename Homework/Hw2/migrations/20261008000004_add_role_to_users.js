exports.up = function (knex) {
    return knex.schema.alterTable('users', (table) => {
        table.text('role').notNullable().defaultTo('student');
    });
};

exports.down = function (knex) {
    return knex.schema.alterTable('users', (table) => {
        table.dropColumn('role');
    });
};
