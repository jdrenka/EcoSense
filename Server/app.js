const express = require('express');
const path = require('path');
const app = express();
const port = 3000;
const db = require('./database');

app.use(express.json());

app.use(express.static(path.join(__dirname, '..', 'Client')));

app.set('view engine', 'ejs');
// Define template directory
app.set('views', 'views');



app.get('/', (req, res) => {
  res.render('index.ejs');
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

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
});
