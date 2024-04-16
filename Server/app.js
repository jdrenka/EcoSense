const express = require('express');
const path = require('path');
const app = express();
const port = 3000;

app.use(express.static(path.join(__dirname, '..', 'Client')));

app.set('view engine', 'ejs');
// Define template directory
app.set('views', 'views');



app.get('/', (req, res) => {
  res.render('index.ejs');
});

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
});
