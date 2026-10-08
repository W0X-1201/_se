const http = require('http');

function req(method, path, body, token, form) {
    return new Promise((resolve, reject) => {
        const headers = {};
        if (token) headers.Authorization = 'Bearer ' + token;
        if (form) {
            // FormData: body is Buffer, boundary set by caller
        } else if (body) {
            headers['Content-Type'] = 'application/json';
        }
        const r = http.request({ host: '127.0.0.1', port: 3000, path, method, headers }, (res) => {
            let d = '';
            res.on('data', (c) => d += c);
            res.on('end', () => {
                let parsed;
                try { parsed = JSON.parse(d); } catch { parsed = d; }
                resolve({ status: res.statusCode, body: parsed });
            });
        });
        r.on('error', reject);
        if (form) r.end(form);
        else r.end(body ? JSON.stringify(body) : undefined);
    });
}

const login = (id, pwd) => req('POST', '/api/login', { studentId: id, password: pwd });

(async () => {
    // ---------- 學生 ----------
    const s = await login('123456', '123456');
    console.log('[學生] login          :', s.status, s.body.user.role, s.body.message);
    const st = s.body.token;

    const courses = await req('GET', '/api/courses', null, st);
    const id = (no) => courses.body.courses.find((c) => c.course_no === no).id;
    console.log('[學生] courses        :', courses.status, `共 ${courses.body.courses.length} 門，視窗：${courses.body.window.message}`);

    const e1 = await req('POST', `/api/courses/${id('CS101')}/enroll`, null, st);
    console.log('[學生] enroll CS101   :', e1.status, e1.body.message);
    const e2 = await req('POST', `/api/courses/${id('PS101')}/enroll`, null, st);
    console.log('[學生] conflict PS101 :', e2.status, e2.body.message);

    const g0 = await req('GET', '/api/grades/summary', null, st);
    console.log('[學生] grades(未發布) :', g0.status, `GPA=${g0.body.summary.gpa} 已修=${g0.body.summary.earnedCredits}`);

    // ---------- 教師 ----------
    const t = await login('111111', '111111');
    console.log('[教師] login          :', t.status, t.body.user.role, t.body.message);
    const tt = t.body.token;

    const tc = await req('GET', '/api/teacher/courses', null, tt);
    console.log('[教師] my courses     :', tc.status, `共 ${tc.body.courses.length} 門`);
    const cid = tc.body.courses[0].id;

    const roster = await req('GET', `/api/teacher/courses/${cid}/roster?date=2026-10-08`, null, tt);
    console.log('[教師] roster         :', roster.status, `學生 ${roster.body.roster.length} 人`);
    const sid = roster.body.roster[0].id;

    const att = await req('POST', `/api/teacher/courses/${cid}/attendance`, { date: '2026-10-08', records: [{ user_id: sid, status: 'present' }] }, tt);
    console.log('[教師] attendance     :', att.status, att.body.message);

    const gr = await req('POST', `/api/teacher/courses/${cid}/grades`, { records: [{ user_id: sid, participation: 85, midterm: 78, final: 92 }] }, tt);
    console.log('[教師] save grades    :', gr.status, gr.body.message);

    const pub = await req('POST', `/api/teacher/courses/${cid}/publish`, null, tt);
    console.log('[教師] publish        :', pub.status, pub.body.message);

    // ---------- 學生看成績 ----------
    const g1 = await req('GET', '/api/grades/summary', null, st);
    const graded = g1.body.courses.find((c) => c.published);
    console.log('[學生] grades(已發布) :', g1.status, `${graded.course_no} 總分=${graded.total} 績點=${graded.gradePoint} GPA=${g1.body.summary.gpa} 已修=${g1.body.summary.earnedCredits}/${g1.body.summary.gradCredits}`);

    // ---------- 權限 ----------
    const forbidden = await req('GET', '/api/admin/users', null, st);
    console.log('[學生] admin API      :', forbidden.status, forbidden.body.message);
    const tForbidden = await req('POST', `/api/courses/${id('CS203')}/enroll`, null, tt);
    console.log('[教師] 選課(非學生)   :', tForbidden.status, tForbidden.body.message);

    // ---------- 管理員 ----------
    const a = await login('admin', '123456');
    console.log('[管理] login          :', a.status, a.body.user.role, a.body.message);
    const at = a.body.token;

    const users = await req('GET', '/api/admin/users', null, at);
    console.log('[管理] users          :', users.status, `共 ${users.body.users.length} 個帳號`);

    const nu = await req('POST', '/api/admin/users', { studentId: '123458', password: '123458', name: '測試學生', department: '資工系一年級', role: 'student' }, at);
    console.log('[管理] create user    :', nu.status, nu.body.message);

    const stats = await req('GET', '/api/admin/stats', null, at);
    console.log('[管理] stats          :', stats.status, `學生${stats.body.totals.students} 教師${stats.body.totals.teachers} 課程${stats.body.totals.courses} 系所${stats.body.departments.length}`);

    // 關閉選課 → 學生被拒
    const close = await req('PUT', '/api/admin/settings', { enroll_open_at: '2026-01-01T00:00', enroll_close_at: '2026-01-02T00:00' }, at);
    console.log('[管理] close window   :', close.status, close.body.window.message);
    const blocked = await req('POST', `/api/courses/${id('MA101')}/enroll`, null, st);
    console.log('[學生] 關窗時選課     :', blocked.status, blocked.body.message);

    // 重新開放
    const reopen = await req('PUT', '/api/admin/settings', { enroll_open_at: '', enroll_close_at: '' }, at);
    console.log('[管理] reopen window  :', reopen.status, reopen.body.window.message);

    const ac = await req('GET', '/api/admin/courses', null, at);
    console.log('[管理] admin courses  :', ac.status, `共 ${ac.body.courses.length} 門`);

    const settings = await req('GET', '/api/admin/settings', null, at);
    console.log('[管理] settings       :', settings.status, `畢業學分=${settings.body.settings.grad_credits}`);

    // ---------- 新功能：搜尋篩選 / 公告 / 出缺勤 / CSV ----------
    const search = await req('GET', '/api/courses?q=' + encodeURIComponent('資料'), null, st);
    console.log('[學生] 搜尋「資料」    :', search.status, `命中 ${search.body.courses.length} 門：${search.body.courses.map((c) => c.course_no).join('/')}`);

    const dep = await req('GET', '/api/courses?department=' + encodeURIComponent('資訊管理系'), null, st);
    console.log('[學生] 系所篩選      :', dep.status, `資管系 ${dep.body.courses.length} 門`);

    const day = await req('GET', '/api/courses?weekday=2&period=3', null, st);
    console.log('[學生] 時段篩選      :', day.status, `週二第3節 ${day.body.courses.length} 門`);

    const annS = await req('GET', '/api/announcements', null, st);
    console.log('[學生] 公告(學生)    :', annS.status, `可見 ${annS.body.announcements.length} 則`);
    const annT = await req('GET', '/api/announcements', null, tt);
    console.log('[教師] 公告(教師)    :', annT.status, `可見 ${annT.body.announcements.length} 則`);

    const annA = await req('POST', '/api/admin/announcements', { title: 'API測試公告', content: '內容', audience: 'all' }, at);
    console.log('[管理] 發布公告      :', annA.status, annA.body.message);
    const annD = await req('DELETE', '/api/admin/announcements/' + (await req('GET', '/api/admin/announcements', null, at)).body.announcements[0].id, null, at);
    console.log('[管理] 刪除公告      :', annD.status, annD.body.message);

    const attRec = await req('GET', '/api/my/attendance', null, st);
    console.log('[學生] 出缺勤查詢    :', attRec.status, `明細 ${attRec.body.records.length} 筆，統計 ${attRec.body.summary.length} 門課`);

    const csvS = await req('GET', '/api/grades/export.csv', null, st);
    console.log('[學生] 成績單 CSV    :', csvS.status, `BOM=${String(csvS.body).charCodeAt(0) === 0xfeff}，含 GPA=${String(csvS.body).includes('GPA')}`);
    const csvT = await req('GET', `/api/teacher/courses/${cid}/export.csv`, null, tt);
    console.log('[教師] 成績 CSV      :', csvT.status, `BOM=${String(csvT.body).charCodeAt(0) === 0xfeff}，含狀態=${String(csvT.body).includes('狀態')}`);
})().catch((e) => { console.error(e); process.exit(1); });
