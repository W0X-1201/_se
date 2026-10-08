const express = require('express');
const db = require('./db');
const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static('public'));

app.post('/api/login', async (req, res) => {
    const { studentId, password } = req.body;

    try {
        const row = await db('users')
            .select('id', 'student_id', 'name', 'department')
            .where({ student_id: studentId, password })
            .first();

        if (row) {
            res.json({
                success: true,
                message: `歡迎回來, ${row.name}!`,
                user: { name: row.name, dept: row.department }
            });
        } else {
            res.status(401).json({ success: false, message: '學號或密碼錯誤' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

app.listen(PORT, () => {
    console.log(`伺服器運行中: http://localhost:${PORT}`);
    console.log(`目前資料庫: ${db.client.config.client}`);
});
