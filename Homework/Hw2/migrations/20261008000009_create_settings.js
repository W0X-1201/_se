exports.up = function (knex) {
    return knex.schema.createTable('settings', (table) => {
        table.text('key').primary();
        table.text('value');
    });
};

exports.down = function (knex) {
    return knex.schema.dropTableIfExists('settings');
};
