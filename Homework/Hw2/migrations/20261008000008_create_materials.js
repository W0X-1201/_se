exports.up = function (knex) {
    return knex.schema.createTable('materials', (table) => {
        table.increments('id').primary();
        table.integer('course_id').notNullable().references('id').inTable('courses');
        table.text('filename').notNullable();
        table.text('stored_name').notNullable();
        table.integer('size').defaultTo(0);
        table.timestamp('uploaded_at').defaultTo(knex.fn.now());
    });
};

exports.down = function (knex) {
    return knex.schema.dropTableIfExists('materials');
};
