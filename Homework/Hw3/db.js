const path = require('path');
const sqlite3 = require('sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'portfolio.sqlite');

const db = new sqlite3.Database(DB_PATH);
db.configure('busyTimeout', 5000);
db.serialize(() => {
    db.run('PRAGMA journal_mode = WAL');
    db.run(`
        CREATE TABLE IF NOT EXISTS portfolio (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            stock_symbol  TEXT    NOT NULL,
            shares        REAL    NOT NULL CHECK (shares > 0),
            buy_price     REAL    NOT NULL CHECK (buy_price >= 0),
            company_name  TEXT    NOT NULL
        )
    `);
});

module.exports = db;
