exports.seed = function (knex) {
    return knex('users')
        .del()
        .then(() =>
            knex('users').insert([
                { student_id: '112001', password: '123456', name: '王小明', department: '資管系' }
            ])
        );
};
