const settings = [
    { key: 'grad_credits', value: '128' },
    { key: 'enroll_open_at', value: '' },
    { key: 'enroll_close_at', value: '' }
];

exports.seed = function (knex) {
    return knex('settings').insert(settings).onConflict('key').merge();
};
