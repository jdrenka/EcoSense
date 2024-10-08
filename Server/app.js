

// ECOSENSE SERVER CODE @ Justin Drenka 
// This file facilitates periodic data retrieval from the ECOSENSE IOT DEVICE through /dataBay 
// Using Twilio, text message alerts are sent to the user based on their created thresholds and alerts. 
// Account Creation, Sign in, Session handling are handled in this file. 
// Historical data CSV download is handled here.
// Note this was intended for personal use. 

const express = require('express');
const path = require('path');
require('dotenv').config();
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

const twilloClient = new twilio(accountSid, authToken);
const twilioNumber = '+15182941286';
const recipient = '+12507183236';


app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

app.set('view engine', 'ejs');
// Define template directory
app.set('views', path.join(__dirname, 'views')); // Assuming 'views' is directly inside your project folder

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

const userSessions = new Map();


app.get('/', (req, res) => {
  res.redirect('/home');
});

app.get('/home', (req, res) => {
  res.render('home.ejs');
});



app.post('/createAccount', async (req, res) => {
  const { username, password, phonenumber, sensorId } = req.body;
    
  try {
      // Check if the sensor ID is valid (but do not register it)
      const [sensorResults] = await db.query('SELECT isRegistered FROM shippedSensors WHERE shippedSensorID = ?', [sensorId]);

      if (sensorResults.length === 0) {
          return res.status(400).json({ success: false, message: 'Invalid sensor ID' });
      }
     
      // Create the user account
      await db.query('INSERT INTO users (username, password, phonenumber) VALUES (?, ?, ?)', [username, password, phonenumber]);

      
      res.json({ success: true, message: 'Account created successfully' });
  } catch (err) {
      console.error('Database error:', err);
      res.status(500).json({ success: false, message: 'Database error' });
  }
});

let isTempAlertSent = false;
let isHumAlertSent = false;
let isLightAlertSent = false;
let isDisconnectAlertSent = false;

// Data receiving from device
app.post('/dataBay', async (req, res, next) => {
    console.log('/dataBay Post Request Initialized ------');
    const { time, temp, hum, light, sid } = req.body;
    console.log('Received Data From ESP32 | Timestamp: ', time, ' Temperature: ', temp, ' Humidity: ', hum, 'Light: ', light, ' SensorID: ', sid);
    console.log("------");
  
    // Function to handle database insertion
    const insertData = async (adjustedTemp, adjustedHum, adjustedLight) => {
      const query = `INSERT INTO readings (timestamp, temperature, humidity, sensor_id, light) VALUES (?, ?, ?, ?, ?)`;
      try {
        const [result] = await db.execute(query, [time, adjustedTemp, adjustedHum, sid, adjustedLight]);
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
          if (alert.data_type === 'disconnect') {
            // If the sensor has reported data, reset the disconnect alert
            await db.query('UPDATE UserAlerts SET alert_sent = FALSE WHERE alert_id = ?', [alert.alert_id]);
            continue;
          }
  
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
  
    // Function to apply calibrations
    const applyCalibrations = async () => {
      let adjustedTemp = temp;
      let adjustedHum = hum;
      let adjustedLight = light;
      try {
        const [calibrations] = await db.query('SELECT * FROM calibrations WHERE sensor_id = ?', [sid]);
        calibrations.forEach(calibration => {
          if (calibration.data_type === 'temp') {
            adjustedTemp += calibration.calibration_value;
            console.log(`Applied temperature calibration: ${calibration.calibration_value}`);
          } else if (calibration.data_type === 'hum') {
            adjustedHum += calibration.calibration_value;
            console.log(`Applied humidity calibration: ${calibration.calibration_value}`);
          } else if (calibration.data_type === 'light') {
            adjustedLight += calibration.calibration_value;
            console.log(`Applied light calibration: ${calibration.calibration_value}`);
          }
        });
      } catch (err) {
        console.error('Error fetching calibrations:', err);
        next(err); // Pass the error to the error handler
      }
      return { adjustedTemp, adjustedHum, adjustedLight };
    };
  
    try {
      // Reset alert_sent flags at the beginning of the handler
      await resetAlertSentFlags();
  
      // Apply calibrations
      const { adjustedTemp, adjustedHum, adjustedLight } = await applyCalibrations();
  
      // Query the database for alerts corresponding to the sensor ID
      let alerts = [];
      let alertIdsToUpdate = [];
      const [results] = await db.query('SELECT * FROM UserAlerts WHERE sensor_id = ?', [sid]);
  
      for (const alert of results) {
        if (alert.data_type === 'disconnect') continue;
  
        const thresholdValue = parseFloat(alert.threshold_value);
        const conditionMet = (alert.data_type === 'temperature' && ((alert.alertCondition === 'less_than' && adjustedTemp < thresholdValue) || (alert.alertCondition === 'greater_than' && adjustedTemp > thresholdValue))) ||
          (alert.data_type === 'humidity' && ((alert.alertCondition === 'less_than' && adjustedHum < thresholdValue) || (alert.alertCondition === 'greater_than' && adjustedHum > thresholdValue))) ||
          (alert.data_type === 'light' && ((alert.alertCondition === 'less_than' && adjustedLight < thresholdValue) || (alert.alertCondition === 'greater_than' && adjustedLight > thresholdValue)));
  
        if (conditionMet && !alert.alert_sent) {
          alerts.push(alert.alertMessage);
          alertIdsToUpdate.push(alert.alert_id); // Collect the alert IDs to update
        }
      }

      const [userIDResults] = await db.query('SELECT user_id FROM sensors WHERE sensor_id = ?', [sid]);

        if (userIDResults.length === 0) {
            return res.status(404).json({ success: false, message: 'Sensor not found' });
        }

        const userID = userIDResults[0].user_id;

        // Fetch the user's phone number from the users table using the user ID
        const [userResults] = await db.query('SELECT phonenumber FROM users WHERE user_id = ?', [userID]);

        if (userResults.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

      const userPhoneNumber = userResults[0].phonenumber;
      
      // If any thresholds are exceeded, send an SMS and wait for it
      if (alerts.length > 0) {
        const messageBody = `EcoSense Alert: ${alerts.join(' ')}`;
        twilloClient.messages.create({
          body: messageBody,
          from: twilioNumber,
          to: '+1' + userPhoneNumber 
        })
          .then(async message => {
            console.log(`Alert Message SID: ${message.sid}`);
  
            // Update alert_sent flag in the database
            if (alertIdsToUpdate.length > 0) {
              const query = 'UPDATE UserAlerts SET alert_sent = TRUE WHERE alert_id IN (?)';
              await db.query(query, [alertIdsToUpdate]);
            }
  
            const dbResult = await insertData(adjustedTemp, adjustedHum, adjustedLight);
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
        const dbResult = await insertData(adjustedTemp, adjustedHum, adjustedLight);
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
  

// Function to check for disconnects
const checkForDisconnects = async () => {
  try {
    for (let [sessionID, userId] of userSessions.entries()) {
      console.log("USERID in DISconnect Check: ", userId);
      const [sensors] = await db.query('SELECT sensor_id, MAX(timestamp) as last_update FROM readings GROUP BY sensor_id');

      const currentTime = new Date(new Date().getTime() - (24 * 60 * 60 * 1000)); // Go back 1 day
      const alertsToSend = [];

      for (const sensor of sensors) {
        let pstOffset = 17 * 60 * 60 * 1000;
        let lastUpdate = new Date(new Date(sensor.last_update).getTime() - pstOffset);
        const timeDifference = (currentTime.getTime() - lastUpdate.getTime()) / 1000; // Time difference in seconds
        console.log("TIMEDIFF: ", timeDifference);

        // Assume a device is disconnected if not updated for more than 10 minutes (600 seconds)
        if (timeDifference > 30) { // Disconnect Notify Time
          const [disconnectAlerts] = await db.query('SELECT * FROM UserAlerts WHERE sensor_id = ? AND data_type = "disconnect" AND alert_sent = FALSE', [sensor.sensor_id]);

          for (const alert of disconnectAlerts) {
            alertsToSend.push({ alert, sensorId: sensor.sensor_id });
          }

          const [userResults] = await db.query('SELECT phonenumber FROM users WHERE user_id = ?', [userId]);

      if (userResults.length === 0) {
        console.error('User not found');
        return;
      }

      const userPhoneNumber = userResults[0].phonenumber;

      for (const alertData of alertsToSend) {
        const { alert, sensorId } = alertData;
        const messageBody = `EcoSense Alert: ${alert.alertMessage}`;
        console.log("bigtest", userPhoneNumber);
        twilloClient.messages.create({
          body: messageBody,
          from: twilioNumber,
          to: '+1' + userPhoneNumber
        })
          .then(async message => {
            console.log(`Disconnect Alert Message SID: ${message.sid}`);

            // Update alert_sent flag in the database
            const query = 'UPDATE UserAlerts SET alert_sent = TRUE WHERE alert_id = ?';
            await db.query(query, [alert.alert_id]);
          })
          .catch(error => {
            console.error('Failed to send disconnect SMS:', error);
          });
      }
        }
      }

      
    }
  } catch (err) {
    console.error('Error checking for disconnects:', err);
  }
};

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

// Retrieve List of Sensors.
app.get('/sensorview', async (req, res, next) => {
  try {
      const userId = req.session.userId;
      userSessions.set(req.sessionID, userId); // Store userId with session ID as the key
      console.log("USERID", userId);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const query = "SELECT sensor_id AS sid, sensor_name AS sname, sensor_type AS stype FROM sensors WHERE user_id = ?";
    const [results, fields] = await db.query(query, [userId]);

    res.render('index.ejs', { sensors: results });
  } catch (err) {
    console.error('Database query failed:', err);
    next(err); // Pass the error to the error handler
  }
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

app.get('/getCalibrations', async (req, res) => {
    const sensorId = req.query.sensorId;

    try {
        const [results] = await db.query('SELECT * FROM calibrations WHERE sensor_id = ?', [sensorId]);
        const calibrations = { temp: 0, hum: 0, light: 0 };

        results.forEach(calibration => {
            if (calibration.data_type === 'temp') {
                calibrations.temp = calibration.calibration_value;
            } else if (calibration.data_type === 'hum') {
                calibrations.hum = calibration.calibration_value;
            } else if (calibration.data_type === 'light') {
                calibrations.light = calibration.calibration_value;
            }
        });

        res.json(calibrations);
    } catch (err) {
        console.error('Error fetching calibrations:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/create-alert', async (req, res, next) => {
  const { alertName, sensorId, dataType, alertCondition, thresholdValue, alertMessage } = req.body;
  const userId = req.session.userId; // Access user ID from session
  let alert_sent = false;

  if (!userId) {
    return res.status(400).json({ success: false, message: 'User ID is required' });
  }

  let query;
  let values;

  if (dataType === 'disconnect') {
    query = `
      INSERT INTO UserAlerts (user_id, sensor_id, data_type, alertName, alertMessage, alert_sent, time_created)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    values = [userId, sensorId, dataType, alertName, alertMessage, alert_sent, new Date()];
  } else {
    query = `
      INSERT INTO UserAlerts (user_id, sensor_id, data_type, alertCondition, threshold_value, alertName, alertMessage, alert_sent, time_created)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    values = [userId, sensorId, dataType, alertCondition, thresholdValue, alertName, alertMessage, alert_sent, new Date()];
  }

  try {
    await db.query(query, values);
    res.json({ success: true });
  } catch (err) {
    console.error('Error creating alert:', err);
    next(err); // Pass the error to the error handler
  }
});





app.get('/download-csv', async (req, res, next) => {
  try {
    const { start, end, sensorId } = req.query;

    // Query to get the sensor name based on sensorId
    const [sensorRows] = await db.query('SELECT sensor_name FROM sensors WHERE sensor_id = ?', [sensorId]);
    if (sensorRows.length === 0) {
      return res.json({ success: false, message: 'Invalid sensor ID' });
    }
    const sensorName = sensorRows[0].sensor_name;

    let query = `
      SELECT timestamp, temperature, humidity, light
      FROM readings
      WHERE sensor_id = ?
    `;
    let values = [sensorId];

    if (start && end) {
      query += ` AND timestamp BETWEEN ? AND ?`;
      values.push(start, end);
    } else {
      const today = new Date().toISOString().split('T')[0];
      query += ` AND DATE(timestamp) = ?`;
      values.push(today);
    }

    const [rows] = await db.query(query, values);

    if (rows.length === 0) {
      return res.json({ success: false, message: 'No data selected for download' });
    }

    // Add the sensor name at the top of the CSV and as a column
    const csvHeader = `Sensor Name: ${sensorName}\n`;

    // Add sensorName to each row
    const rowsWithSensorName = rows.map(row => ({
      timestamp: row.timestamp,
      sensor_name: sensorName,
      temperature: row.temperature,
      humidity: row.humidity,
      light: row.light,
    }));

    const csv = csvHeader + parse(rowsWithSensorName);

    // Set headers for CSV download
    res.setHeader('Content-Disposition', 'attachment; filename="data.csv"');
    res.setHeader('Content-Type', 'text/csv');

    // Stream the CSV data to the response
    res.send(csv);
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

app.post('/calibrate', async (req, res) => {
 
  const { sensorId, dataType, calibrationValue } = req.body;

  try {
      // Check if a calibration already exists for the sensor and data type
      const selectQuery = 'SELECT calibration_value FROM calibrations WHERE sensor_id = ? AND data_type = ?';
      const [results] = await db.query(selectQuery, [sensorId, dataType]);

      if (results.length > 0) {
         
          // Calibration exists, update it
          const currentCalibrationValue = results[0].calibration_value;
          const newCalibrationValue = currentCalibrationValue + calibrationValue;

          const updateQuery = 'UPDATE calibrations SET calibration_value = ? WHERE sensor_id = ? AND data_type = ?';
          await db.query(updateQuery, [newCalibrationValue, sensorId, dataType]);
          res.json({ success: true });
      } else {
          
          // Calibration does not exist, insert a new one
          const insertQuery = 'INSERT INTO calibrations (sensor_id, data_type, calibration_value) VALUES (?, ?, ?)';
          await db.query(insertQuery, [sensorId, dataType, calibrationValue]);
          res.json({ success: true });
      }
  } catch (err) {
      console.error('Database error', err);
      res.status(500).json({ success: false, error: 'Database error' });
  }
});


app.post('/deleteCalibration', async (req, res) => {
  const { sensorId, dataType } = req.body;

  try {
      const deleteQuery = 'DELETE FROM calibrations WHERE sensor_id = ? AND data_type = ?';
      await db.query(deleteQuery, [sensorId, dataType]);
      res.json({ success: true });
  } catch (err) {
      console.error('Error deleting calibration', err);
      res.status(500).json({ success: false, error: 'Database error' });
  }
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
  const userId = req.session.userId;
  try {
    const [sensors] = await db.query('SELECT sensor_id, sensor_name FROM sensors WHERE user_id = ?', [userId]);

    res.json(sensors);
  } catch (err) {
    console.error('Error fetching sensors:', err);
    next(err); // Pass the error to the error handler
  }
});


app.post('/addSensor', async (req, res) => {
  const { sensorId, sensorName, sensorType } = req.body;
  const userId = req.session.userId;

  if (!userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
  }

  try {
      // Check if the sensor ID is valid and not already registered
      const [results] = await db.query('SELECT isRegistered FROM shippedSensors WHERE shippedSensorID = ?', [sensorId]);

      if (results.length === 0) {
          return res.status(400).json({ success: false, message: 'Invalid sensor ID' });
      }

      if (results[0].isRegistered) {
          return res.status(400).json({ success: false, message: 'Sensor ID already registered' });
      }

      // Register the sensor
      await db.query('UPDATE shippedSensors SET isRegistered = TRUE WHERE shippedSensorID = ?', [sensorId]);
      await db.query('INSERT INTO sensors (sensor_id, sensor_name, sensor_type, user_id) VALUES (?, ?, ?, ?)', [sensorId, sensorName, sensorType, userId]);

      res.json({ success: true, message: 'Sensor registered successfully' });
  } catch (err) {
      console.error('Database error:', err);
      res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.get('/alertView', async (req, res, next) => {
  const userId = req.session.userId;
  try {
    const query = `
            SELECT UserAlerts.*, sensors.sensor_name
            FROM UserAlerts
            JOIN sensors ON UserAlerts.sensor_id = sensors.sensor_id WHERE sensors.user_id = ?;
        `;
    const [results, fields] = await db.query(query, [userId]);
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


setInterval(() => {
  checkForDisconnects();
}, 10000); // Check every 100 seconds

// Use the error handling middleware
app.use(errorHandler);

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});
