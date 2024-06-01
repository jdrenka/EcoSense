// database.js
const mysql = require('mysql2/promise');

// Create a connection pool
const pool = mysql.createPool({
  host: '34.105.88.144',  // or your host
  user: 'root',
  password: 'showdb',
  database: 'SensorReadings',
  waitForConnections: true,
  connectionLimit: 50,
  queueLimit: 0,
  connectTimeout: 10000,
});

module.exports = pool;
