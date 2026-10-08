const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('./db');

const app = express();
const PORT = 3000;

const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        const safe = Buffer.from(file.originalname, 'latin1').toString('utf8');
        cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safe}`);
    }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

app.use(express.json());
app.use(express.static('public'));

const sessions = new Map();

function auth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const user = token ? sessions.get(token) : null;
    if (!user) return res.status(401).json({ success: false, message: '請先登入' });
    req.user = user;
    next();
}

function requireRole(...roles) {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ success: false, message: '沒有權限執行此操作' });
        }
        next();
    };
}

async function getSetting(key, fallback = '') {
    const row = await db('settings').where({ key }).first();
    return row ? row.value : fallback;
}

async function enrollmentWindow() {
    const openAt = await getSetting('enroll_open_at');
    const closeAt = await getSetting('enroll_close_at');
    if (!openAt || !closeAt) return { open: true, message: '選課開放中（未設定時間窗）', openAt, closeAt };
    const now = Date.now();
    if (now < Date.parse(openAt)) return { open: false, message: '選課尚未開放', openAt, closeAt };
    if (now > Date.parse(closeAt)) return { open: false, message: '選課時間已結束', openAt, closeAt };
    return { open: true, message: '選課開放中', openAt, closeAt };
}

function gradePoint(total) {
    if (total >= 90) return 4.0;
    if (total >= 85) return 3.7;
    if (total >= 80) return 3.3;
    if (total >= 77) return 3.0;
    if (total >= 73) return 2.7;
    if (total >= 70) return 2.3;
    if (total >= 67) return 2.0;
    if (total >= 63) return 1.7;
    if (total >= 60) return 1.3;
    return 0;
}

function calcTotal(participation, midterm, final) {
    return Math.round((participation * 0.3 + midterm * 0.3 + final * 0.4) * 10) / 10;
}

// ===================== 登入 =====================
app.post('/api/login', async (req, res) => {
    const { studentId, password } = req.body;
    try {
        const row = await db('users')
            .select('id', 'student_id', 'name', 'department', 'role')
            .where({ student_id: studentId, password })
            .first();
        if (!row) return res.status(401).json({ success: false, message: '帳號或密碼錯誤' });

        const token = crypto.randomBytes(24).toString('hex');
        sessions.set(token, row);
        res.json({
            success: true,
            message: `歡迎回來, ${row.name}!`,
            token,
            user: { name: row.name, dept: row.department, studentId: row.student_id, role: row.role }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

app.post('/api/logout', auth, (req, res) => {
    const header = req.headers.authorization || '';
    sessions.delete(header.slice(7));
    res.json({ success: true });
});

app.get('/api/me', auth, (req, res) => {
    const u = req.user;
    res.json({ success: true, user: { name: u.name, dept: u.department, studentId: u.student_id, role: u.role } });
});

// ===================== 校園公告 =====================
app.get('/api/announcements', auth, async (req, res) => {
    try {
        const rows = await db('announcements')
            .leftJoin('users', 'users.id', 'announcements.created_by')
            .select('announcements.id', 'announcements.title', 'announcements.content', 'announcements.audience', 'announcements.created_at', 'users.name as author')
            .modify((b) => {
                if (req.user.role !== 'admin') {
                    b.whereIn('announcements.audience', ['all', req.user.role]);
                }
            })
            .orderBy('announcements.created_at', 'desc');
        res.json({ success: true, announcements: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

// ===================== 學生：課程 / 選課 =====================
app.get('/api/courses', auth, async (req, res) => {
    try {
        const { q, department, weekday, period } = req.query;
        const courses = await db('courses')
            .leftJoin('users', 'users.id', 'courses.teacher_id')
            .select('courses.*', 'users.name as teacher_name')
            .modify((b) => {
                if (q) {
                    b.where((w) => {
                        w.where('courses.course_no', 'like', `%${q}%`)
                            .orWhere('courses.name', 'like', `%${q}%`)
                            .orWhere('courses.description', 'like', `%${q}%`)
                            .orWhere('users.name', 'like', `%${q}%`);
                    });
                }
                if (department) b.where('courses.department', department);
                if (weekday) b.where('courses.weekday', Number(weekday));
                if (period) {
                    b.where('courses.start_period', '<=', Number(period))
                        .where('courses.end_period', '>=', Number(period));
                }
            })
            .orderBy('courses.weekday')
            .orderBy('courses.start_period');

        const departments = (await db('courses').distinct('department').pluck('department'))
            .filter(Boolean).sort();

        const myIds = new Set(
            req.user.role === 'student'
                ? await db('enrollments').where('user_id', req.user.id).pluck('course_id')
                : []
        );

        const enrolledCounts = {};
        for (const row of await db('enrollments').select('course_id').count({ c: 'id' }).groupBy('course_id')) {
            enrolledCounts[row.course_id] = Number(row.c);
        }

        let totalCredits = 0;
        if (req.user.role === 'student') {
            const sum = await db('enrollments')
                .join('courses', 'courses.id', 'enrollments.course_id')
                .where('enrollments.user_id', req.user.id)
                .sum({ s: 'courses.credit' })
                .first();
            totalCredits = Number(sum.s || 0);
        }

        res.json({
            success: true,
            totalCredits,
            selectedCount: myIds.size,
            departments,
            window: await enrollmentWindow(),
            courses: courses.map((c) => ({
                ...c,
                enrolled: enrolledCounts[c.id] || 0,
                remaining: Math.max(0, c.capacity - (enrolledCounts[c.id] || 0)),
                selected: myIds.has(c.id)
            }))
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

app.get('/api/schedule', auth, async (req, res) => {
    try {
        const rows = await db('enrollments')
            .join('courses', 'courses.id', 'enrollments.course_id')
            .where('enrollments.user_id', req.user.id)
            .select(
                'courses.id', 'courses.course_no', 'courses.name', 'courses.teacher',
                'courses.weekday', 'courses.start_period', 'courses.end_period',
                'courses.classroom', 'courses.credit'
            )
            .orderBy('courses.weekday')
            .orderBy('courses.start_period');
        res.json({ success: true, courses: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

async function checkEnrollmentWindow(res) {
    const w = await enrollmentWindow();
    if (!w.open) {
        res.status(403).json({ success: false, message: w.message });
        return false;
    }
    return true;
}

app.post('/api/courses/:id/enroll', auth, requireRole('student'), async (req, res) => {
    const courseId = Number(req.params.id);
    const userId = req.user.id;
    try {
        if (!(await checkEnrollmentWindow(res))) return;

        const result = await db.transaction(async (trx) => {
            const course = await trx('courses').where({ id: courseId }).first();
            if (!course) return { status: 404, body: { success: false, message: '課程不存在' } };

            const mine = await trx('enrollments').where({ user_id: userId, course_id: courseId }).first();
            if (mine) return { status: 409, body: { success: false, message: '已經選過這門課' } };

            const cnt = await trx('enrollments').where({ course_id: courseId }).count({ c: 'id' }).first();
            if (Number(cnt.c) >= course.capacity) {
                return { status: 409, body: { success: false, message: '課程人數已滿' } };
            }

            const others = await trx('enrollments')
                .join('courses', 'courses.id', 'enrollments.course_id')
                .where('enrollments.user_id', userId)
                .select('courses.weekday', 'courses.start_period', 'courses.end_period', 'courses.name');

            const conflict = others.find(
                (o) =>
                    o.weekday === course.weekday &&
                    course.start_period <= o.end_period &&
                    o.start_period <= course.end_period
            );
            if (conflict) {
                return { status: 409, body: { success: false, message: `與「${conflict.name}」時間衝突` } };
            }

            await trx('enrollments').insert({ user_id: userId, course_id: courseId });
            return { status: 200, body: { success: true, message: `已選課：${course.name}` } };
        });
        res.status(result.status).json(result.body);
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

app.delete('/api/courses/:id/enroll', auth, requireRole('student'), async (req, res) => {
    try {
        if (!(await checkEnrollmentWindow(res))) return;
        const deleted = await db('enrollments')
            .where({ user_id: req.user.id, course_id: Number(req.params.id) })
            .del();
        if (!deleted) return res.status(404).json({ success: false, message: '你沒有選這門課' });
        res.json({ success: true, message: '已退選' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

// ===================== 學生：成績 / GPA / 學分追蹤 =====================
app.get('/api/grades/summary', auth, requireRole('student'), async (req, res) => {
    try {
        const rows = await db('enrollments')
            .join('courses', 'courses.id', 'enrollments.course_id')
            .leftJoin('grades', function () {
                this.on('grades.course_id', 'enrollments.course_id').andOn('grades.user_id', 'enrollments.user_id');
            })
            .where('enrollments.user_id', req.user.id)
            .select(
                'courses.id as course_id',
                'courses.course_no',
                'courses.name',
                'courses.credit',
                'grades.participation',
                'grades.midterm',
                'grades.final',
                'grades.total',
                'grades.published'
            )
            .orderBy('courses.course_no');

        let earnedCredits = 0;
        let gradeCredits = 0;
        let pointSum = 0;

        const courses = rows.map((r) => {
            const published = !!r.published;
            const passed = published && r.total >= 60;
            if (passed) earnedCredits += r.credit;
            if (published) {
                const gp = gradePoint(r.total);
                gradeCredits += r.credit;
                pointSum += gp * r.credit;
            }
            return {
                course_id: r.course_id,
                course_no: r.course_no,
                name: r.name,
                credit: r.credit,
                published,
                participation: r.participation,
                midterm: r.midterm,
                final: r.final,
                total: r.total,
                gradePoint: published ? gradePoint(r.total) : null
            };
        });

        const gradCredits = Number(await getSetting('grad_credits', '128'));
        const gpa = gradeCredits > 0 ? Math.round((pointSum / gradeCredits) * 100) / 100 : null;

        res.json({
            success: true,
            courses,
            summary: {
                earnedCredits,
                gradCredits,
                progress: Math.min(100, Math.round((earnedCredits / gradCredits) * 100)),
                gpa,
                gradedCredits: gradeCredits
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

// ===================== 學生：出缺勤查詢 =====================
const ATT_STATUS = { present: '出席', late: '遲到', absent: '缺席', leave: '請假' };

app.get('/api/my/attendance', auth, requireRole('student'), async (req, res) => {
    try {
        const records = await db('attendance')
            .join('courses', 'courses.id', 'attendance.course_id')
            .where('attendance.user_id', req.user.id)
            .select(
                'attendance.date', 'attendance.status',
                'courses.course_no', 'courses.name as course_name'
            )
            .orderBy('attendance.date', 'desc')
            .orderBy('courses.course_no');

        const summaryMap = {};
        for (const r of records) {
            if (!summaryMap[r.course_no]) {
                summaryMap[r.course_no] = { course_no: r.course_no, course_name: r.course_name, present: 0, late: 0, absent: 0, leave: 0, total: 0 };
            }
            const s = summaryMap[r.course_no];
            s[r.status] = (s[r.status] || 0) + 1;
            s.total++;
        }

        res.json({
            success: true,
            records: records.map((r) => ({ ...r, statusText: ATT_STATUS[r.status] || r.status })),
            summary: Object.values(summaryMap)
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

// ===================== CSV 匯出 =====================
function csvCell(v) {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function sendCsv(res, filename, rows) {
    const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send('\uFEFF' + csv);
}

app.get('/api/grades/export.csv', auth, requireRole('student'), async (req, res) => {
    try {
        const rows = await db('enrollments')
            .join('courses', 'courses.id', 'enrollments.course_id')
            .leftJoin('grades', function () {
                this.on('grades.course_id', 'enrollments.course_id').andOn('grades.user_id', 'enrollments.user_id');
            })
            .where('enrollments.user_id', req.user.id)
            .select('courses.course_no', 'courses.name', 'courses.credit', 'grades.participation', 'grades.midterm', 'grades.final', 'grades.total', 'grades.published')
            .orderBy('courses.course_no');

        const data = [['課號', '課程名稱', '學分', '平時(30%)', '期中(30%)', '期末(40%)', '總成績', '績點', '狀態']];
        let earned = 0, gradeCredits = 0, pointSum = 0;
        for (const r of rows) {
            const published = !!r.published;
            if (published && r.total >= 60) earned += r.credit;
            let gp = '';
            if (published) {
                gp = gradePoint(r.total);
                gradeCredits += r.credit;
                pointSum += gp * r.credit;
            }
            data.push([
                r.course_no, r.name, r.credit,
                published ? r.participation : '未發布',
                published ? r.midterm : '未發布',
                published ? r.final : '未發布',
                published ? r.total : '',
                published ? gp : '',
                published ? (r.total >= 60 ? '及格' : '不及格') : '未發布'
            ]);
        }
        const gpa = gradeCredits > 0 ? (pointSum / gradeCredits).toFixed(2) : '';
        const gradCredits = Number(await getSetting('grad_credits', '128'));
        data.push([]);
        data.push(['GPA', gpa, '', '已修得學分', earned, '', '畢業要求', gradCredits]);

        sendCsv(res, `成績單_${req.user.name}_${req.user.student_id}.csv`, data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

// ===================== 教材（學生下載） =====================
app.get('/api/my/materials', auth, requireRole('student'), async (req, res) => {
    try {
        const rows = await db('materials')
            .join('courses', 'courses.id', 'materials.course_id')
            .join('enrollments', 'enrollments.course_id', 'materials.course_id')
            .where('enrollments.user_id', req.user.id)
            .select('materials.id', 'materials.filename', 'materials.size', 'materials.uploaded_at', 'courses.name as course_name', 'courses.course_no')
            .orderBy('materials.uploaded_at', 'desc');
        res.json({ success: true, materials: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

async function canAccessCourse(user, courseId) {
    if (user.role === 'admin') return true;
    const course = await db('courses').where({ id: courseId }).first();
    if (!course) return false;
    if (user.role === 'teacher') return course.teacher_id === user.id;
    const enr = await db('enrollments').where({ user_id: user.id, course_id: courseId }).first();
    return !!enr;
}

app.get('/api/materials/:mid/download', auth, async (req, res) => {
    try {
        const m = await db('materials').where({ id: Number(req.params.mid) }).first();
        if (!m) return res.status(404).json({ success: false, message: '檔案不存在' });
        if (!(await canAccessCourse(req.user, m.course_id))) {
            return res.status(403).json({ success: false, message: '沒有權限下載' });
        }
        res.download(path.join(UPLOAD_DIR, m.stored_name), m.filename);
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

// ===================== 教師端 =====================
app.get('/api/teacher/courses', auth, requireRole('teacher', 'admin'), async (req, res) => {
    try {
        const courses = await db('courses')
            .where({ teacher_id: req.user.id })
            .orderBy('weekday')
            .orderBy('start_period');
        const result = [];
        for (const c of courses) {
            const cnt = await db('enrollments').where({ course_id: c.id }).count({ c: 'id' }).first();
            result.push({ ...c, enrolled: Number(cnt.c) });
        }
        res.json({ success: true, courses: result });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

async function checkTeacherCourse(req, res) {
    const course = await db('courses').where({ id: Number(req.params.id) }).first();
    if (!course) {
        res.status(404).json({ success: false, message: '課程不存在' });
        return null;
    }
    if (req.user.role !== 'admin' && course.teacher_id !== req.user.id) {
        res.status(403).json({ success: false, message: '不是這門課的授課教師' });
        return null;
    }
    return course;
}

app.get('/api/teacher/courses/:id/roster', auth, requireRole('teacher', 'admin'), async (req, res) => {
    try {
        const course = await checkTeacherCourse(req, res);
        if (!course) return;

        const roster = await db('enrollments')
            .join('users', 'users.id', 'enrollments.user_id')
            .where('enrollments.course_id', course.id)
            .select('users.id', 'users.student_id', 'users.name', 'users.department');

        const date = req.query.date || '';
        const attendance = {};
        if (date) {
            for (const a of await db('attendance').where({ course_id: course.id, date })) {
                attendance[a.user_id] = a.status;
            }
        }

        const grades = {};
        for (const g of await db('grades').where({ course_id: course.id })) {
            grades[g.user_id] = g;
        }

        res.json({
            success: true,
            course,
            roster: roster.map((s) => ({
                ...s,
                attendance: attendance[s.id] || '',
                grade: grades[s.id] || null
            }))
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

app.post('/api/teacher/courses/:id/attendance', auth, requireRole('teacher', 'admin'), async (req, res) => {
    try {
        const course = await checkTeacherCourse(req, res);
        if (!course) return;
        const { date, records } = req.body;
        if (!date || !Array.isArray(records)) {
            return res.status(400).json({ success: false, message: '缺少日期或點名資料' });
        }
        for (const r of records) {
            await db('attendance')
                .insert({ user_id: r.user_id, course_id: course.id, date, status: r.status })
                .onConflict(['user_id', 'course_id', 'date'])
                .merge(['status']);
        }
        res.json({ success: true, message: `已儲存 ${records.length} 筆點名紀錄` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

app.post('/api/teacher/courses/:id/grades', auth, requireRole('teacher', 'admin'), async (req, res) => {
    try {
        const course = await checkTeacherCourse(req, res);
        if (!course) return;
        const { records } = req.body;
        if (!Array.isArray(records)) {
            return res.status(400).json({ success: false, message: '缺少成績資料' });
        }
        for (const r of records) {
            const p = Number(r.participation) || 0;
            const m = Number(r.midterm) || 0;
            const f = Number(r.final) || 0;
            await db('grades')
                .insert({
                    user_id: r.user_id,
                    course_id: course.id,
                    participation: p,
                    midterm: m,
                    final: f,
                    total: calcTotal(p, m, f),
                    published: false
                })
                .onConflict(['user_id', 'course_id'])
                .merge({ participation: p, midterm: m, final: f, total: calcTotal(p, m, f), published: false });
        }
        res.json({ success: true, message: `已儲存 ${records.length} 筆成績（尚未發布）` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

app.post('/api/teacher/courses/:id/publish', auth, requireRole('teacher', 'admin'), async (req, res) => {
    try {
        const course = await checkTeacherCourse(req, res);
        if (!course) return;
        const updated = await db('grades').where({ course_id: course.id }).update({ published: true });
        res.json({ success: true, message: `已發布 ${updated} 筆成績` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

app.get('/api/teacher/courses/:id/export.csv', auth, requireRole('teacher', 'admin'), async (req, res) => {
    try {
        const course = await checkTeacherCourse(req, res);
        if (!course) return;

        const roster = await db('enrollments')
            .join('users', 'users.id', 'enrollments.user_id')
            .where('enrollments.course_id', course.id)
            .select('users.student_id', 'users.name', 'users.department', 'users.id as uid');

        const grades = {};
        for (const g of await db('grades').where({ course_id: course.id })) grades[g.user_id] = g;

        const data = [
            ['課程', `${course.course_no} ${course.name}`],
            ['授課教師', course.teacher],
            [],
            ['學號', '姓名', '系所', '平時(30%)', '期中(30%)', '期末(40%)', '總成績', '狀態']
        ];
        for (const s of roster) {
            const g = grades[s.uid];
            data.push([
                s.student_id, s.name, s.department,
                g ? g.participation : '', g ? g.midterm : '', g ? g.final : '',
                g ? g.total : '',
                g ? (g.published ? '已發布' : '未發布') : '未輸入'
            ]);
        }
        sendCsv(res, `${course.course_no}_${course.name}_成績.csv`, data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

app.get('/api/teacher/courses/:id/materials', auth, requireRole('teacher', 'admin'), async (req, res) => {
    try {
        const course = await checkTeacherCourse(req, res);
        if (!course) return;
        const rows = await db('materials').where({ course_id: course.id }).orderBy('uploaded_at', 'desc');
        res.json({ success: true, materials: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

app.post('/api/teacher/courses/:id/materials', auth, requireRole('teacher', 'admin'), upload.single('file'), async (req, res) => {
    try {
        const course = await checkTeacherCourse(req, res);
        if (!course) return;
        if (!req.file) return res.status(400).json({ success: false, message: '未上傳檔案' });
        const filename = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
        await db('materials').insert({
            course_id: course.id,
            filename,
            stored_name: req.file.filename,
            size: req.file.size
        });
        res.json({ success: true, message: `已上傳：${filename}` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

app.delete('/api/teacher/materials/:mid', auth, requireRole('teacher', 'admin'), async (req, res) => {
    try {
        const m = await db('materials').where({ id: Number(req.params.mid) }).first();
        if (!m) return res.status(404).json({ success: false, message: '檔案不存在' });
        if (req.user.role !== 'admin') {
            const course = await db('courses').where({ id: m.course_id }).first();
            if (!course || course.teacher_id !== req.user.id) {
                return res.status(403).json({ success: false, message: '沒有權限' });
            }
        }
        await db('materials').where({ id: m.id }).del();
        fs.unlink(path.join(UPLOAD_DIR, m.stored_name), () => {});
        res.json({ success: true, message: '已刪除檔案' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

// ===================== 管理員：校園公告 =====================
app.get('/api/admin/announcements', auth, requireRole('admin'), async (req, res) => {
    try {
        const rows = await db('announcements')
            .leftJoin('users', 'users.id', 'announcements.created_by')
            .select('announcements.*', 'users.name as author')
            .orderBy('announcements.created_at', 'desc');
        res.json({ success: true, announcements: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

app.post('/api/admin/announcements', auth, requireRole('admin'), async (req, res) => {
    const { title, content, audience } = req.body;
    if (!title || !content) return res.status(400).json({ success: false, message: '標題與內容為必填' });
    if (!['all', 'student', 'teacher', 'admin'].includes(audience || 'all')) {
        return res.status(400).json({ success: false, message: '發布對象不正確' });
    }
    try {
        await db('announcements').insert({ title, content, audience: audience || 'all', created_by: req.user.id });
        res.json({ success: true, message: '公告已發布' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

app.delete('/api/admin/announcements/:id', auth, requireRole('admin'), async (req, res) => {
    try {
        const deleted = await db('announcements').where({ id: Number(req.params.id) }).del();
        if (!deleted) return res.status(404).json({ success: false, message: '公告不存在' });
        res.json({ success: true, message: '公告已刪除' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

app.get('/api/admin/users', auth, requireRole('admin'), async (req, res) => {
    try {
        const users = await db('users')
            .select('id', 'student_id', 'name', 'department', 'role')
            .orderBy('role')
            .orderBy('student_id');
        res.json({ success: true, users });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

app.post('/api/admin/users', auth, requireRole('admin'), async (req, res) => {
    const { studentId, password, name, department, role } = req.body;
    if (!studentId || !password || !name) {
        return res.status(400).json({ success: false, message: '帳號、密碼、姓名為必填' });
    }
    if (!['student', 'teacher', 'admin'].includes(role)) {
        return res.status(400).json({ success: false, message: '角色不正確' });
    }
    try {
        const exists = await db('users').where({ student_id: studentId }).first();
        if (exists) return res.status(409).json({ success: false, message: '帳號已存在' });
        await db('users').insert({
            student_id: studentId,
            password,
            name,
            department: department || '',
            role
        });
        res.json({ success: true, message: `已建立帳號 ${studentId}` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

app.patch('/api/admin/users/:id', auth, requireRole('admin'), async (req, res) => {
    try {
        const user = await db('users').where({ id: Number(req.params.id) }).first();
        if (!user) return res.status(404).json({ success: false, message: '帳號不存在' });

        const updates = {};
        if (req.body.role) {
            if (!['student', 'teacher', 'admin'].includes(req.body.role)) {
                return res.status(400).json({ success: false, message: '角色不正確' });
            }
            updates.role = req.body.role;
        }
        if (req.body.password) updates.password = req.body.password;
        if (req.body.department !== undefined) updates.department = req.body.department;
        if (req.body.name) updates.name = req.body.name;

        await db('users').where({ id: user.id }).update(updates);
        res.json({ success: true, message: `已更新 ${user.student_id}` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

app.get('/api/admin/courses', auth, requireRole('admin'), async (req, res) => {
    try {
        const courses = await db('courses')
            .leftJoin('users', 'users.id', 'courses.teacher_id')
            .select('courses.*', 'users.name as teacher_name')
            .orderBy('weekday')
            .orderBy('start_period');
        const counts = {};
        for (const row of await db('enrollments').select('course_id').count({ c: 'id' }).groupBy('course_id')) {
            counts[row.course_id] = Number(row.c);
        }
        res.json({
            success: true,
            courses: courses.map((c) => ({
                ...c,
                enrolled: counts[c.id] || 0,
                fillRate: c.capacity ? Math.round(((counts[c.id] || 0) / c.capacity) * 100) : 0
            }))
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

async function validateCourse(body) {
    const required = ['course_no', 'name', 'weekday', 'start_period', 'end_period', 'capacity'];
    for (const k of required) {
        if (body[k] === undefined || body[k] === '') return `缺少欄位：${k}`;
    }
    if (Number(body.start_period) > Number(body.end_period)) return '起始節次不可大於結束節次';
    if (Number(body.weekday) < 1 || Number(body.weekday) > 5) return '星期須為 1～5';
    return null;
}

app.post('/api/admin/courses', auth, requireRole('admin'), async (req, res) => {
    try {
        const err = await validateCourse(req.body);
        if (err) return res.status(400).json({ success: false, message: err });

        const exists = await db('courses').where({ course_no: req.body.course_no }).first();
        if (exists) return res.status(409).json({ success: false, message: '課號已存在' });

        const overlapping = await db('courses')
            .where({ weekday: Number(req.body.weekday) })
            .where('start_period', '<=', Number(req.body.end_period))
            .where('end_period', '>=', Number(req.body.start_period))
            .where({ teacher_id: req.body.teacher_id || null })
            .first();
        if (overlapping && req.body.teacher_id) {
            return res.status(409).json({ success: false, message: `與「${overlapping.name}」教師時間衝突` });
        }

        await db('courses').insert({
            course_no: req.body.course_no,
            name: req.body.name,
            teacher: req.body.teacher || '',
            teacher_id: req.body.teacher_id || null,
            weekday: Number(req.body.weekday),
            start_period: Number(req.body.start_period),
            end_period: Number(req.body.end_period),
            classroom: req.body.classroom || '',
            credit: Number(req.body.credit) || 0,
            capacity: Number(req.body.capacity) || 0,
            department: req.body.department || '',
            description: req.body.description || ''
        });
        res.json({ success: true, message: `已新增課程 ${req.body.course_no}` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

app.patch('/api/admin/courses/:id', auth, requireRole('admin'), async (req, res) => {
    try {
        const course = await db('courses').where({ id: Number(req.params.id) }).first();
        if (!course) return res.status(404).json({ success: false, message: '課程不存在' });

        const updates = {};
        const allow = ['name', 'teacher', 'teacher_id', 'weekday', 'start_period', 'end_period', 'classroom', 'credit', 'capacity', 'department', 'description'];
        for (const k of allow) {
            if (req.body[k] !== undefined) updates[k] = typeof req.body[k] === 'number' ? req.body[k] : (['weekday', 'start_period', 'end_period', 'credit', 'capacity'].includes(k) ? Number(req.body[k]) : req.body[k]);
        }
        if (updates.start_period && updates.end_period && updates.start_period > updates.end_period) {
            return res.status(400).json({ success: false, message: '起始節次不可大於結束節次' });
        }
        await db('courses').where({ id: course.id }).update(updates);
        res.json({ success: true, message: `已更新課程 ${course.course_no}` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

app.get('/api/admin/settings', auth, requireRole('admin'), async (req, res) => {
    try {
        res.json({
            success: true,
            settings: {
                grad_credits: await getSetting('grad_credits', '128'),
                enroll_open_at: await getSetting('enroll_open_at'),
                enroll_close_at: await getSetting('enroll_close_at')
            },
            window: await enrollmentWindow()
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

app.put('/api/admin/settings', auth, requireRole('admin'), async (req, res) => {
    try {
        const allow = ['grad_credits', 'enroll_open_at', 'enroll_close_at'];
        for (const k of allow) {
            if (req.body[k] !== undefined) {
                await db('settings').insert({ key: k, value: String(req.body[k]) }).onConflict('key').merge();
            }
        }
        res.json({ success: true, message: '設定已更新', window: await enrollmentWindow() });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

app.get('/api/admin/stats', auth, requireRole('admin'), async (req, res) => {
    try {
        const totals = {
            students: Number((await db('users').where('role', 'student').count({ c: 'id' }).first()).c),
            teachers: Number((await db('users').where('role', 'teacher').count({ c: 'id' }).first()).c),
            courses: Number((await db('courses').count({ c: 'id' }).first()).c),
            enrollments: Number((await db('enrollments').count({ c: 'id' }).first()).c)
        };

        const departments = await db('users')
            .where('role', 'student')
            .groupBy('department')
            .select('department')
            .count({ c: 'id' })
            .orderBy('c', 'desc');

        const courses = await db('courses')
            .leftJoin('enrollments', 'enrollments.course_id', 'courses.id')
            .select('courses.id', 'courses.course_no', 'courses.name', 'courses.capacity')
            .count({ enrolled: 'enrollments.id' })
            .groupBy('courses.id')
            .orderBy('courses.course_no');

        const courseStats = courses.map((c) => ({
            ...c,
            enrolled: Number(c.enrolled),
            fillRate: c.capacity ? Math.round((Number(c.enrolled) / c.capacity) * 100) : 0
        }));

        res.json({
            success: true,
            totals,
            departments: departments.map((d) => ({ department: d.department || '未設定', count: Number(d.c) })),
            courses: courseStats
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

app.listen(PORT, () => {
    console.log(`伺服器運行中: http://localhost:${PORT}`);
    console.log(`目前資料庫: ${db.client.config.client}`);
});
