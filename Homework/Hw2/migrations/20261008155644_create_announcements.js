exports.up = function (knex) {
    return knex.schema.createTable('announcements', (t) => {
        t.increments('id');
        t.string('title').notNullable();
        t.text('content').notNullable();
        t.string('audience').notNullable().defaultTo('all'); // all / student / teacher / admin
        t.integer('created_by').notNullable();
        t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    });
};

exports.down = function (knex) {
    return knex.schema.dropTable('announcements');
};
