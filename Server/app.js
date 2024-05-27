const express = require('express');
const path = require('path');
const app = express();
const port = 3000;
const db = require('./database');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');
const twilio = require('twilio');
const { parse } = require('json2csv');
const fs = require('fs');
const errorHandler = require('./errorHandler'); // Import the error handler

const accountSid = 'AC5f47c13f6d37a8f58634ef22a03fc8ff';
const authToken = 'e998f5610837db5b647845687b82dfcf';
const twilloClient = new twilio(accountSid, authToken);
const twilioNumber = '+15182941286';
const recipient = '+12507183236';

const tempThreshold = 30;
const humidityThreshold = 50;
const lightThreshold = 150;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(express.static(path.join(__dirname, '..', 'Client')));

app.set('view engine', 'ejs');
// Define template directory
app.set('views', 'views');

//Session info
app.use(session({
  secret: 'your_secret_key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 3600000,
    secure: false, // set true if using HTTPS
    httpOnly: true
  }
}));

let isTempAlertSent = false;
let isHumAlertSent = false;
let isLightAlertSent = false;

// Data receiving from device
app.post('/dataBay', async (req, res, next) => {
  console.log('/dataBay Post Request Initialized ------');
  const { time, temp, hum, light, sid } = req.body;
  console.log('Received Data From ESP32 | Timestamp: ', time, ' Temperature: ', temp, ' Humidity: ', hum, 'Light: ', light, ' SensorID: ', sid);
  console.log("------");

  // Function to handle database insertion
  const insertData = async () => {
    const query = `INSERT INTO readings (timestamp, temperature, humidity, sensor_id, light) VALUES (?, ?, ?, ?, ?)`;
    try {
      const [result] = await db.execute(query, [time, temp, hum, sid, light]);
      console.log('Data inserted successfully:', result.insertId);
      return { success: true, insertId: result.insertId };
    } catch (err) {
      console.error('Database error:', err);
      return { success: false, error: err };
    }
  };

  // Function to reset alert_sent flags
  const resetAlertSentFlags = async () => {
    try {
      const [results] = await db.query('SELECT * FROM UserAlerts WHERE sensor_id = ?', [sid]);

      for (const alert of results) {
        const thresholdValue = parseFloat(alert.threshold_value);
        const resetCondition = (alert.alertCondition === 'less_than' && (alert.data_type === 'temperature' && temp >= thresholdValue * 1.1 || alert.data_type === 'humidity' && hum >= thresholdValue * 1.1 || alert.data_type === 'light' && light >= thresholdValue * 1.1)) ||
          (alert.alertCondition === 'greater_than' && (alert.data_type === 'temperature' && temp <= thresholdValue * 0.9 || alert.data_type === 'humidity' && hum <= thresholdValue * 0.9 || alert.data_type === 'light' && light <= thresholdValue * 0.9));

        if (resetCondition) {
          await db.query('UPDATE UserAlerts SET alert_sent = FALSE WHERE alert_id = ?', [alert.alert_id]);
        }
      }
    } catch (err) {
      console.error('Database error:', err);
      next(err); // Pass the error to the error handler
    }
  };

  try {
    // Reset alert_sent flags at the beginning of the handler
    await resetAlertSentFlags();

    // Query the database for alerts corresponding to the sensor ID
    let alerts = [];
    let alertIdsToUpdate = [];
    const [results] = await db.query('SELECT * FROM UserAlerts WHERE sensor_id = ?', [sid]);

    for (const alert of results) {
      const thresholdValue = parseFloat(alert.threshold_value);
      const conditionMet = (alert.data_type === 'temperature' && ((alert.alertCondition === 'less_than' && temp < thresholdValue) || (alert.alertCondition === 'greater_than' && temp > thresholdValue))) ||
        (alert.data_type === 'humidity' && ((alert.alertCondition === 'less_than' && hum < thresholdValue) || (alert.alertCondition === 'greater_than' && hum > thresholdValue))) ||
        (alert.data_type === 'light' && ((alert.alertCondition === 'less_than' && light < thresholdValue) || (alert.alertCondition === 'greater_than' && light > thresholdValue)));

      if (conditionMet && !alert.alert_sent) {
        alerts.push(alert.alertMessage);
        alertIdsToUpdate.push(alert.alert_id); // Collect the alert IDs to update
      }
    }

    // If any thresholds are exceeded, send an SMS and wait for it
    if (alerts.length > 0) {
      const messageBody = `Alert: ${alerts.join(' ')}`;
      twilloClient.messages.create({
        body: messageBody,
        from: twilioNumber,
        to: '+12507183236' // Hardcoded phone number for now
      })
        .then(async message => {
          console.log(`Alert Message SID: ${message.sid}`);

          // Update alert_sent flag in the database
          if (alertIdsToUpdate.length > 0) {
            const query = 'UPDATE UserAlerts SET alert_sent = TRUE WHERE alert_id IN (?)';
            await db.query(query, [alertIdsToUpdate]);
          }

          const dbResult = await insertData();
          if (dbResult.success) {
            res.status(201).json({ alert: messageBody, message: 'Alert sent and data inserted successfully', id: dbResult.insertId });
          } else {
            next(new Error('Alert sent but failed to insert data'));
          }
        })
        .catch(error => {
          console.error('Failed to send SMS:', error);
          next(error); // Pass the error to the error handler
        });
    } else {
      const dbResult = await insertData();
      if (dbResult.success) {
        res.status(201).json({ message: 'Data inserted successfully', id: dbResult.insertId });
      } else {
        next(new Error('Error inserting data into database'));
      }
    }
  } catch (err) {
    next(err); // Pass the error to the error handler
  }
});

// Check auth middleware ---
function ensureAuthenticated(req, res, next) {
  if (req.session.isLoggedIn) {
    next();
  } else {
    res.redirect('/login');
  }
}

// ALL ROUTE HANDLERS PAST THIS POINT ARE AUTH GUARDED
app.use((req, res, next) => {
  if (req.path === '/login') {
    next(); // Skip middleware for login and register routes
  } else {
    ensureAuthenticated(req, res, next); // Apply authentication check
  }
});

app.get('/', (req, res) => {
  res.redirect('/login');
});

// Retrieve List of Sensors.
app.get('/sensorview', async (req, res, next) => {
  try {
    const query = "SELECT sensor_id AS sid, sensor_name AS sname, sensor_type AS stype FROM sensors";
    const [results, fields] = await db.query(query);
    res.render('index.ejs', { sensors: results });
  } catch (err) {
    console.error('Database query failed:', err);
    next(err); // Pass the error to the error handler
  }
});

app.get('/send-test-sms', (req, res, next) => {
  // Define the message
  const message = "Toe ass u can never block me now  Love - Justin";

  twilloClient.messages.create({
    body: message,
    from: twilioNumber,
    to: recipient
  })
    .then(message => {
      console.log(`Message SID: ${message.sid}`);
      res.send(`Test SMS sent successfully! Message SID: ${message.sid}`);
    })
    .catch(error => {
      console.error(error);
      next(error); // Pass the error to the error handler
    });
});

app.get('/recentData/:sensorId', async (req, res, next) => {
  const sensorId = req.params.sensorId; // Assuming you're getting the sensorId from the route parameter

  const query = 'SELECT timestamp, temperature, humidity, light, sensor_id FROM readings WHERE sensor_id = ? ORDER BY timestamp DESC LIMIT 1';

  try {
    const [rows] = await db.query(query, [sensorId]); // Passing sensorId to the query
    if (rows.length > 0) {
      res.json(rows[0]); // Send the latest row of sensor data
    } else {
      res.status(404).send('No data found for this sensor');
    }
  } catch (error) {
    console.error('Database error:', error);
    next(error); // Pass the error to the error handler
  }
});

app.get('/download-csv', async (req, res, next) => {
  try {
    const { start, end } = req.query;
    let query = `
      SELECT timestamp, temperature, humidity, light
      FROM readings
    `;
    let values = [];

    // Check if the first 4 characters of both start and end are greater than or equal to 2003
    if (start && end) {
      const startYear = parseInt(start.substring(0, 4));
      const endYear = parseInt(end.substring(0, 4));

      if (startYear >= 2003 && endYear >= 2003) {
        query += `WHERE timestamp BETWEEN ? AND ?`;
        values = [start, end];
      } else {
        const today = '2024-05-17';
        query += `WHERE DATE(timestamp) = ?`;
        values = [today];
      }
    } else {
      const today = '2024-05-17';
      query += `WHERE DATE(timestamp) = ?`;
      values = [today];
    }

    const [rows] = await db.query(query, values);

    if (rows.length === 0) {
      return res.status(400).send('No data available for the selected date range.');
    }

    const csv = parse(rows);
    const filePath = path.join(__dirname, 'data.csv');
    fs.writeFileSync(filePath, csv);

    res.download(filePath, 'data.csv', (err) => {
      if (err) {
        console.error('Error downloading the CSV file', err);
        next(err); // Pass the error to the error handler
      }
      fs.unlinkSync(filePath); // Delete the file after sending it
    });
  } catch (err) {
    console.error('Error generating CSV:', err);
    next(err); // Pass the error to the error handler
  }
});

app.get('/daily-report', async (req, res, next) => {
  try {
    const today = new Date();
    const todayString = today.toISOString().split('T')[0];
    const query = `
        SELECT timestamp, temperature, humidity, light
        FROM readings
        WHERE DATE(timestamp) = '2024-05-17';
    `;
    const values = [todayString];

    const [rows, fields] = await db.query(query, values);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching daily report data', err);
    next(err); // Pass the error to the error handler
  }
});

app.get('/range-report', async (req, res, next) => {
  const { start, end, sensorId } = req.query;
  if (!start || !end) {
    return res.status(400).send('Start and end dates are required');
  }

  try {
    const query = `
      SELECT timestamp, temperature, humidity, light
      FROM readings
      WHERE timestamp BETWEEN ? AND ?
      AND sensor_id = ?;
    `;

    const formatDateToUTC = (date) => {
      const d = new Date(date);
      const year = d.getUTCFullYear();
      const month = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      const hours = String(d.getUTCHours()).padStart(2, '0');
      const minutes = String(d.getUTCMinutes()).padStart(2, '0');
      const seconds = String(d.getUTCSeconds()).padStart(2, '0');
      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    };

    const formattedStart = formatDateToUTC(start);
    const formattedEnd = formatDateToUTC(end);
    const values = [formattedStart, formattedEnd, sensorId];
    const [rows] = await db.query(query, values);

    res.json(rows);
  } catch (err) {
    console.error('Error fetching range report data', err);
    next(err); // Pass the error to the error handler
  }
});

// Render sensor details page.
app.get('/sensorDash', async (req, res, next) => {
  const sensorId = req.query.sensorId; // Retrieve the sensor ID from the query parameters

  if (!sensorId) {
    // Respond with an error if no sensor ID is provided
    return res.status(400).send('Sensor ID is required');
  }

  try {
    // Assuming 'db' is your database connection object
    // Replace 'sensor_table' with your actual table name
    const [rows] = await db.execute('SELECT sensor_name FROM sensors WHERE sensor_id = ?', [sensorId]);

    if (rows.length === 0) {
      // No sensor found with the given ID
      return res.status(404).send('Sensor not found');
    }

    const sensorName = rows[0].sensor_name; // assuming the column name is 'sensor_name'
    res.render('sensorDash', { sensorId: sensorId, sensorName: sensorName });
  } catch (err) {
    console.error('Database error:', err);
    next(err); // Pass the error to the error handler
  }
});

// Twillo stuff: Twillo phone number:  +15182941286,
app.post('/send-sms', (req, res, next) => {
  const { message, to } = req.body;

  if (!message || !to) {
    return res.status(400).send('Please provide both a message and a recipient number.');
  }

  twilloClient.messages.create({
    body: message,
    from: twilioNumber,
    to: to
  })
    .then(message => {
      console.log(`Message SID: ${message.sid}`);
      res.send(`SMS sent successfully to ${to}! Message SID: ${message.sid}`);
    })
    .catch(error => {
      console.error(error);
      next(error); // Pass the error to the error handler
    });
});

app.post('/login', async (req, res, next) => {
  const { username, password } = req.body;
  try {
    const query = 'SELECT * FROM users WHERE username = ? AND password = ?';
    const [results] = await db.query(query, [username, password]);

    if (results.length > 0) {
      req.session.isLoggedIn = true;
      req.session.userId = results[0].user_id;
      req.session.user = results[0]; // Store user data in session
      res.redirect('/sensorview');
    } else {
        res.render('login', { error: 'Incorrect Username or Password' });
    }
  } catch (error) {
    console.error('Database error:', error);
    next(error); // Pass the error to the error handler
  }
});

app.delete('/delete-alert/:id', async (req, res, next) => {
  const alertId = req.params.id;

  try {
    const query = 'DELETE FROM UserAlerts WHERE alert_id = ?';
    await db.query(query, [alertId]);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting alert', err);
    next(err); // Pass the error to the error handler
  }
});

// Logout route
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid'); // Assuming session ID cookie name is 'connect.sid'
    res.redirect('/login');
  });
});

app.get('/sensors', async (req, res, next) => {
  try {
    const [sensors] = await db.query('SELECT sensor_id, sensor_name FROM sensors');
    res.json(sensors);
  } catch (err) {
    console.error('Error fetching sensors:', err);
    next(err); // Pass the error to the error handler
  }
});

app.post('/create-alert', async (req, res, next) => {
  const { sensorId, dataType, alertCondition, thresholdValue, phoneNumber, alertMessage } = req.body;
  const userId = req.session.userId; // Access user ID from session
  let alert_sent = false;
  if (!userId) {
    return res.status(400).json({ success: false, message: 'User ID is required' });
  }

  const query = `
    INSERT INTO UserAlerts (user_id, sensor_id, data_type, alertCondition, threshold_value, phone_number, alertName, alertMessage, alert_sent, time_created)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const alertName = `${dataType} Alert`;

  try {
    const values = [userId, sensorId, dataType, alertCondition, thresholdValue, phoneNumber, alertName, alertMessage, alert_sent, new Date()];
    await db.query(query, values);
    res.json({ success: true });
  } catch (err) {
    console.error('Error creating alert:', err);
    next(err); // Pass the error to the error handler
  }
});

app.get('/alertView', async (req, res, next) => {
  try {
    const query = `
            SELECT UserAlerts.*, sensors.sensor_name
            FROM UserAlerts
            JOIN sensors ON UserAlerts.sensor_id = sensors.sensor_id;
        `;
    const [results, fields] = await db.query(query);
    res.render('alerts.ejs', { alerts: results });
  } catch (err) {
    console.error('Database query failed:', err);
    next(err); // Pass the error to the error handler
  }
});

// Endpoint to get the latest readings for each sensor
app.get('/latest-readings', async (req, res, next) => {
  try {
    const query = `
          SELECT r.sensor_id, r.temperature, r.humidity, r.light, r.timestamp, s.sensor_name AS sname
          FROM readings r
          INNER JOIN sensors s ON r.sensor_id = s.sensor_id
          WHERE (r.sensor_id, r.timestamp) IN (
              SELECT sensor_id, MAX(timestamp)
              FROM readings
              GROUP BY sensor_id
          )
      `;
    const [results] = await db.query(query);
    res.json(results);
  } catch (err) {
    console.error('Error fetching latest readings:', err);
    next(err); // Pass the error to the error handler
  }
});

app.get('/login', (req, res) => {
  res.render('login.ejs');
});

// Use the error handling middleware
app.use(errorHandler);

app.listen(port, '0.0.0.0', () => {
  console.log(`Example app listening at http://localhost:${port}`);
});
