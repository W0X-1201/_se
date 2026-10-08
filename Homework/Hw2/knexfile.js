const path = require('path');

const client = process.env.DB_CLIENT || 'sqlite3';

const configs = {
    sqlite3: {
        client: 'sqlite3',
        connection: {
            filename: path.join(__dirname, 'database.sqlite')
        },
        useNullAsDefault: true
    },
    pg: {
        client: 'pg',
        connection: process.env.DATABASE_URL || {
            host: process.env.PG_HOST || 'localhost',
            port: Number(process.env.PG_PORT) || 5432,
            user: process.env.PG_USER || 'postgres',
            password: process.env.PG_PASSWORD || 'postgres',
            database: process.env.PG_DATABASE || 'nqu_system'
        }
    }
};

if (!configs[client]) {
    throw new Error(`不支援的 DB_CLIENT: ${client}（可用: sqlite3, pg）`);
}

module.exports = {
    development: configs[client],
    production: configs[client]
};
