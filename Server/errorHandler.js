const path = require('path');

module.exports = (err, req, res, next) => {
    console.error(err.stack);

    res.status(500).send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Error</title>
            <link rel="stylesheet" href="/styles.css">
            <style>
                body {
                    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    margin: 0;
                    background-color: #1a1a1a;
                }
                .error-container {
                    width: 80%;
                    text-align: center;
                    border: 1px solid #ffffff;
                    padding: 2vw;
                    border-radius: 10px;
                    box-shadow: 0 0 20px rgba(0, 0, 0, 0.1);
                    height: 80%;
                    
                }
                .error-container h1 {
                    margin-top: 4vw;
                    font-size: 3vw;
                    color: #3a3ac2;
                    margin: 0;
                }
                .error-container p {
                    margin-top: 7px;
                    font-size: 18px;
                    color: #e6e6ff;
                }
                .error-container .emoji {
                    margin-top: 7%;
                    font-size: 5vw;
                }

                #top-text{
                    margin-top: 2vw;
                }
                .error-container a {
                    display: inline-block;
                    margin-top: 2vw;
                    padding: 10px 20px;
                    background-color: #3a3ac2;
                    color: white;
                    text-decoration: none;
                    border-radius: 5px;
                    transition: background-color 0.3s;
                }
                .error-container a:hover {
                    background-color: #0056b3;
                }
            </style>
        </head>
        <body>
            <div class="error-container">
                <div class="emoji">⚙️</div>
                <h1>Server Error</h1>
                <p id = "top-text" >Please try again later, Check for scheduled maintenance</p>
                <p>If issue persists contact: jpdrenka@gmail.com</p>
                <a href="/">Go to Homepage</a>
            </div>
        </body>
        </html>
    `);
};
