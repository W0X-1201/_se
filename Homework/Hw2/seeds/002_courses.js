const courses = [
    { course_no: 'CS101', name: '程式設計', teacher: '陳鍾誠', teacher_account: '111111', department: '資訊工程系', weekday: 1, start_period: 1, end_period: 2, classroom: 'B101', credit: 3, capacity: 60, description: '以 C 語言介紹程式設計基礎：變數、迴圈、函式與資料結構入門。' },
    { course_no: 'CS203', name: '資料結構', teacher: '陳鍾誠', teacher_account: '111111', department: '資訊工程系', weekday: 2, start_period: 3, end_period: 4, classroom: 'B203', credit: 3, capacity: 50, description: '陣列、鏈結串列、堆疊、佇列、樹與圖的實作與應用，並探討排序與搜尋演算法。' },
    { course_no: 'CS310', name: '資料庫系統', teacher: '陳鍾誠', teacher_account: '111111', department: '資訊工程系', weekday: 3, start_period: 3, end_period: 4, classroom: 'B310', credit: 3, capacity: 45, description: '關聯式資料庫理論、SQL 程式語言、正規化設計與交易管理實務。' },
    { course_no: 'IM110', name: '管理學', teacher: '李怡君', teacher_account: '111112', department: '資訊管理系', weekday: 1, start_period: 3, end_period: 4, classroom: 'C302', credit: 2, capacity: 70, description: '管理功能與程序：規劃、組織、領導、控制，以及現代管理議題探讨。' },
    { course_no: 'IM215', name: '會計學', teacher: '李怡君', teacher_account: '111112', department: '資訊管理系', weekday: 3, start_period: 5, end_period: 6, classroom: 'C405', credit: 3, capacity: 55, description: '會計學原理：交易分析、會計循環、財務報表編製與基礎財務分析。' },
    { course_no: 'IM320', name: '資訊系統分析', teacher: '李怡君', teacher_account: '111112', department: '資訊管理系', weekday: 5, start_period: 5, end_period: 6, classroom: 'C508', credit: 3, capacity: 40, description: '系統開發生命週期、需求訪談、UML 建模與系統分析設計方法。' },
    { course_no: 'MA101', name: '微積分', teacher: '王富美', teacher_account: '111113', department: '數學系', weekday: 2, start_period: 1, end_period: 2, classroom: 'D201', credit: 3, capacity: 80, description: '極限、連續、微分與積分的觀念與計算，並介紹應用問題。' },
    { course_no: 'PS101', name: '普通生物學', teacher: '王富美', teacher_account: '111113', department: '生命科學系', weekday: 1, start_period: 1, end_period: 2, classroom: 'E101', credit: 2, capacity: 50, description: '細胞生物、遺傳、演化與生態等生物學基本概念與實驗觀察。' },
    { course_no: 'EN102', name: '英文', teacher: '張雅婷', teacher_account: '111114', department: '外文系', weekday: 4, start_period: 7, end_period: 8, classroom: 'D105', credit: 2, capacity: 40, description: '強化英文聽說讀寫能力，著重學術閱讀與基礎寫作訓練。' }
];

exports.seed = async function (knex) {
    const rows = courses.map(({ teacher_account, ...c }) => c);
    await knex('courses').insert(rows).onConflict('course_no').merge();

    for (const c of courses) {
        const teacher = await knex('users').where({ student_id: c.teacher_account }).first();
        if (teacher) {
            await knex('courses').where({ course_no: c.course_no }).update({ teacher_id: teacher.id });
        }
    }
};
