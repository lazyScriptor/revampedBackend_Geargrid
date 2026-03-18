import app from "./app.js";
import sequelize from "./config/database.js";

const port = process.env.PORT || 8085;

// Test DB Connection and start server
sequelize
  .authenticate()
  .then(() => {
    console.log("Database connection has been established successfully.");
    app.listen(port, () => {
      console.log(
        `Server is running in production architecture on port ${port}`,
      );
    });
  })
  .catch((error) => {
    console.error("Unable to connect to the database:", error);
  });
