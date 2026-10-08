exports.up = function (knex) {
    return knex.schema.createTable('grades', (table) => {
        table.increments('id').primary();
        table.integer('user_id').notNullable().references('id').inTable('users');
        table.integer('course_id').notNullable().references('id').inTable('courses');
        table.float('participation').defaultTo(0);
        table.float('midterm').defaultTo(0);
        table.float('final').defaultTo(0);
        table.float('total').defaultTo(0);
        table.boolean('published').defaultTo(false);
        table.unique(['user_id', 'course_id']);
    });
};

exports.down = function (knex) {
    return knex.schema.dropTableIfExists('grades');
};
