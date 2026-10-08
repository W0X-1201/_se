const users = [
    { student_id: '123456', password: '123456', name: '林哲宇', department: '資工系二年級', role: 'student' },
    { student_id: '123457', password: '123457', name: '張家瑜', department: '資管系二年級', role: 'student' },
    { student_id: '111111', password: '111111', name: '陳鍾誠', department: '資工系', role: 'teacher' },
    { student_id: '111112', password: '111112', name: '李怡君', department: '資管系', role: 'teacher' },
    { student_id: '111113', password: '111113', name: '王富美', department: '數學系', role: 'teacher' },
    { student_id: '111114', password: '111114', name: '張雅婷', department: '外文系', role: 'teacher' },
    { student_id: 'admin', password: '123456', name: '系統管理員', department: '電算中心', role: 'admin' }
];

exports.seed = function (knex) {
    return knex('users').insert(users).onConflict('student_id').merge();
};
