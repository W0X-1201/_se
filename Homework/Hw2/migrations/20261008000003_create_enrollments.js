exports.up = function (knex) {
    return knex.schema.createTable('enrollments', (table) => {
        table.increments('id').primary();
        table.integer('user_id').notNullable().references('id').inTable('users');
        table.integer('course_id').notNullable().references('id').inTable('courses');
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.unique(['user_id', 'course_id']);
    });
};

exports.down = function (knex) {
    return knex.schema.dropTableIfExists('enrollments');
};
