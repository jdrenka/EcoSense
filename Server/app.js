const express = require('express');
const path = require('path');
const app = express();
const port = 3000;
const db = require('./database');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');
const twilio = require('twilio');


const accountSid = 'AC5f47c13f6d37a8f58634ef22a03fc8ff';
const authToken = 'e998f5610837db5b647845687b82dfcf';
const twilloClient = new twilio(accountSid, authToken);
const twilioNumber = '+15182941286';
const recipient = '+12507183236';

const tempThreshold = 30; 
const humidityThreshold = 50;

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

// Data recieving from device
app.post('/dataBay', async (req, res) => {
  console.log('/dataBay Post Request Initialized ------');
  const {time, temp, hum, light, sid} = req.body;
  console.log('Received Data From ESP32 | Timestamp: ', time, ' Temperature: ', temp, ' Humidity: ', hum , 'Light: ', light, ' SensorID: ', sid);
    console.log("------");
  let alerts = [];
  // Check temperature threshold
  if (temp > tempThreshold && !isTempAlertSent) {
      alerts.push(`Temperature of ${temp}°C exceeds the threshold of ${tempThreshold}°C.`);
      isTempAlertSent = true;  // Set the flag
  } else if (temp <= tempThreshold) {
      isTempAlertSent = false;  // Reset the flag when condition is normal
  }

  // Check humidity threshold
  if (hum > humidityThreshold && !isHumAlertSent) {
      alerts.push(`Humidity of ${hum}% exceeds the threshold of ${humidityThreshold}%.`);
      isHumAlertSent = true;  // Set the flag
  } else if (hum <= humidityThreshold) {
      isHumAlertSent = false;  // Reset the flag when condition is normal
  }

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

  // If any thresholds are exceeded, send an SMS and wait for it
  if (alerts.length > 0) {
      const messageBody = `Alert: ${alerts.join(' ')}`;
      twilloClient.messages.create({
          body: messageBody,
          from: twilioNumber,
          to: '+12507183236'
      })
      .then(async message => {
          console.log(`Alert Message SID: ${message.sid}`);
          const dbResult = await insertData();
          if (dbResult.success) {
              res.status(201).json({ alert: messageBody, message: 'Alert sent and data inserted successfully', id: dbResult.insertId });
          } else {
              res.status(500).json({ alert: messageBody, message: 'Alert sent but failed to insert data', error: dbResult.error });
          }
      })
      .catch(error => {
          console.error('Failed to send SMS:', error);
          res.status(500).json({ message: 'Failed to send SMS', error });
      });
  } else {
      const dbResult = await insertData();
      if (dbResult.success) {
          res.status(201).json({ message: 'Data inserted successfully', id: dbResult.insertId });
      } else {
          res.status(500).json({ message: 'Error inserting data into database', error: dbResult.error });
      }
  }
});

//Check auth middleware ---
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
      next();  // Skip middleware for login and register routes
  } else {
      ensureAuthenticated(req, res, next);  // Apply authentication check
  }
});

app.get('/', (req, res) => {
  res.redirect('/login');
});

//Retrieve List of Sensors. 
app.get('/sensorview', async (req, res) => {
  try {
      const query = "SELECT sensor_id AS sid, sensor_name AS sname, sensor_type AS stype FROM sensors";
      const [results, fields] = await db.query(query);
      res.render('index.ejs', { sensors: results });
  } catch (err) {
      console.error('Database query failed:', err);
      res.status(500).send('Database error');
  }
});

app.get('/send-test-sms', (req, res) => {
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
      res.status(500).send('Failed to send SMS');
  });
});


app.get('/recentData/:sensorId', async (req, res) => {
    const sensorId = req.params.sensorId;  // Assuming you're getting the sensorId from the route parameter

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
        res.status(500).send('Internal Server Error');
    }
});


app.get('/daily-report', async (req, res) => {
  try {
      const today = new Date();
      const todayString = today.toISOString().split('T')[0];
      const query = `
          SELECT timestamp, temperature, humidity
          FROM readings
          WHERE DATE(timestamp) = "2024-05-09";
      `;
      const values = [todayString];

      const [rows, fields] = await db.query(query, values);
      res.json(rows);
  } catch (err) {
      console.error('Error fetching daily report data', err);
      res.status(500).send('Server error');
  }
});

//Render sensor details page. 
app.get('/sensorDash', async (req, res) => {
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
        res.status(500).send('Internal Server Error');
    }
});


//Twillo stuff: Twillo phone number:  +15182941286, 


app.post('/send-sms', (req, res) => {
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
      res.status(500).send('Failed to send SMS');
  });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
      const query = 'SELECT * FROM users WHERE username = ? AND password = ?';
      const [results] = await db.query(query, [username, password]);

      if (results.length > 0) {
          req.session.isLoggedIn = true;
          req.session.user = results[0]; // Store user data in session
          res.redirect('/sensorview');
      } else {
        res.status(401).send(`
        <html>
            <head>
                <title>Invalid Login</title>
                <style>
                    body {
                        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
                        text-align: center;
                        padding-top: 50px;
                        background-color: #181934;
                        color: #white;
                    }
                    h1 {
                        color: #de4d4d;
                    }
                    p {
                        font-size: 16px;
                        color: white;
                    }
                    a {
                        display: inline-block;
                        padding: 10px 15px;
                        margin-top: 20px;
                        border-radius: 5px;
                        background-color: rgb(103, 103, 103);
                        color: white;
                        text-decoration: none;
                        transition: background-color 0.3s;
                    }
                    a:hover {
                        background-color: #0056b3;
                    }
                    @keyframes fadeIn {
                        from { opacity: 0.25; }
                        to { opacity: 1; }
                    }
                    body {
                        animation: fadeIn 0.5s ease-in-out;
                    }
                </style>
            </head>
            <body>
                <h1>Invalid Login Attempt</h1>
                <p>You will be redirected back to the login page in 5 seconds.</p>
                <p>If you are not redirected, <a href="/login">click here</a> to return to the login page.</p>
                <script>
                    setTimeout(function() {
                        window.location.href = "/login";
                    }, 5000);
                </script>
            </body>
        </html>
    `);
      }
  } catch (error) {
      console.error('Database error:', error);
      res.status(500).send('Database error');
  }
});

// Logout route
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
      res.clearCookie('connect.sid'); // Assuming session ID cookie name is 'connect.sid'
      res.redirect('/login');
  });
});


app.get('/login', (req, res) => {
  res.render('login.ejs');
});


app.listen(port, '0.0.0.0', () => {
  console.log(`Example app listening at http://localhost:${port}`);
});
