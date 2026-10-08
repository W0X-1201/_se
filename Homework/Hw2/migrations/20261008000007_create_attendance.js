exports.up = function (knex) {
    return knex.schema.createTable('attendance', (table) => {
        table.increments('id').primary();
        table.integer('user_id').notNullable().references('id').inTable('users');
        table.integer('course_id').notNullable().references('id').inTable('courses');
        table.text('date').notNullable();
        table.text('status').notNullable();
        table.unique(['user_id', 'course_id', 'date']);
    });
};

exports.down = function (knex) {
    return knex.schema.dropTableIfExists('attendance');
};
