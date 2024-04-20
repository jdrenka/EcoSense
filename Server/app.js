const express = require('express');
const path = require('path');
const app = express();
const port = 3000;
const db = require('./database');
const session = require('express-session');
const bcrypt = require('bcryptjs');

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

function ensureAuthenticated(req, res, next) {
  if (req.session.isLoggedIn) {
      next();  // User is logged in, proceed to the next function in the stack
  } else {
      res.redirect('/login');  // User is not logged in, redirect to login page
  }
}

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

app.get('/recentData', async (req, res) => {
  try {
    // Query to get the latest sensor data
    const query = 'SELECT timestamp, temperature, humidity FROM readings ORDER BY timestamp DESC LIMIT 1';
    const [rows] = await db.query(query);
    if (rows.length > 0) {
      res.json(rows[0]); // Send the latest row of sensor data
    } else {
      res.status(404).json({ message: "No data available" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('Error fetching data');
  }
});

app.get('/daily-report', async (req, res) => {
  try {
      const today = new Date();
      const todayString = today.toISOString().split('T')[0];
      
      const query = `
          SELECT timestamp, temperature, humidity
          FROM readings
          WHERE DATE(timestamp) = ?;
      `;
      const values = [todayString];

      const [rows, fields] = await db.query(query, values);
      
      res.json(rows);
  } catch (err) {
      console.error('Error fetching daily report data', err);
      res.status(500).send('Server error');
  }
});


app.get('/sensorDash', (req,res) => {
  const sensorId = req.query.sensorId; // Retrieve the sensor ID from the query parameters

    if (!sensorId) {
        // Respond with an error if no sensor ID is provided
        return res.status(400).send('Sensor ID is required');
    }
    res.render('sensorDash', { sensorId: sensorId });
});

app.post('/dataBay', async (req, res) => {
  //Sensor ID is required to be sent in req. ESP will send this
  console.log();
  console.log('/dataBay Post Request Initialized ------');

  const {time, temp, hum, sid} = req.body; 
  console.log('Recieved Data From ESP32 | Timestamp: ', time, ' Temperature: ', temp, ' Humidity: ', hum); 

  const query = `INSERT INTO readings (timestamp, temperature, humidity, sensor_id) VALUES (?, ?, ?, ?)`;

    try {
        // Execute the SQL query with the data received from the ESP32
        const [result] = await db.execute(query, [time, temp, hum, sid]);

        // Respond to the client with success message and the ID of the inserted record
        res.status(201).json({ message: 'Data inserted successfully', id: result.insertId });
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ message: 'Error inserting data into database' });
    }

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
                <h1>Invalid Password</h1>
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


app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
});
