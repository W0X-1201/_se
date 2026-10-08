const announcements = [
    {
        title: '115-1 學期選課作業開始',
        content: '115-1 學期選課作業已開放，請各位同學於選課時間窗內完成選課與退選。選課前請務必確認先修課程與上課時間，避免時段衝突。',
        audience: 'student'
    },
    {
        title: '教學卓越計畫－免費線上課程資源',
        content: '學校圖書館訂購之線上學習平台已開放校園網內免費使用，包含程式語言、資料分析與證照準備等課程，歡迎師生多加利用。',
        audience: 'all'
    },
    {
        title: '期中教學評量提醒',
        content: '期中教學評量將於第 9 週進行，請授課教師於評量後兩週內完成成績輸入與發布，以利學生即時檢視學習成果。',
        audience: 'teacher'
    },
    {
        title: '選課時間窗設定說明',
        content: '管理端已新增「選課時間窗」功能，可設定選課開放與關閉時間；關閉期間學生將無法進行選課與退選作業。',
        audience: 'admin'
    }
];

exports.seed = async function (knex) {
    const admin = await knex('users').where({ student_id: 'admin' }).first();
    const titles = announcements.map((a) => a.title);
    await knex('announcements').whereIn('title', titles).del();
    await knex('announcements').insert(
        announcements.map((a) => ({ ...a, created_by: admin ? admin.id : 1 }))
    );
};
