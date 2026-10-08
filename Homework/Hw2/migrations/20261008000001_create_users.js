exports.up = function (knex) {
    return knex.schema.createTable('users', (table) => {
        table.increments('id').primary();
        table.text('student_id').notNullable().unique();
        table.text('password').notNullable();
        table.text('name');
        table.text('department');
    });
};

exports.down = function (knex) {
    return knex.schema.dropTableIfExists('users');
};
