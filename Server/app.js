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

app.post('/dataBay', async (req, res) => {

  console.log('/dataBay Post Request Initialized ------');

  const {time, temp, hum} = req.body; 
  console.log('Recieved Data From ESP32 | Timestamp: ', time, ' Temperature: ', temp, ' Humidity: ', hum); 

  const query = `INSERT INTO readings (timestamp, temperature, humidity) VALUES (?, ?, ?)`;

    try {
        // Execute the SQL query with the data received from the ESP32
        const [result] = await db.execute(query, [timestamp, temperature, humidity]);

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
