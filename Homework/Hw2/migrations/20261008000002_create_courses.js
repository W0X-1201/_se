exports.up = function (knex) {
    return knex.schema.createTable('courses', (table) => {
        table.increments('id').primary();
        table.text('course_no').notNullable().unique();
        table.text('name').notNullable();
        table.text('teacher');
        table.integer('weekday').notNullable();
        table.integer('start_period').notNullable();
        table.integer('end_period').notNullable();
        table.text('classroom');
        table.integer('credit').defaultTo(0);
        table.integer('capacity').defaultTo(0);
    });
};

exports.down = function (knex) {
    return knex.schema.dropTableIfExists('courses');
};
