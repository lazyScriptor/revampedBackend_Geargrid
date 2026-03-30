import app from "./app.js";
import { masterSequelize } from "./config/database.js"; // <-- 1. Import the named Master connection

const PORT = process.env.PORT || 8086;

const startServer = async () => {
  try {
    // 2. Authenticate ONLY with the Master Database on startup
    await masterSequelize.authenticate();
    console.log("✅ Successfully connected to the geargrid_master database.");

    // Optional: If you want Sequelize to auto-create the Master tables (TENANTS, GLOBAL_USERS)
    // await masterSequelize.sync({ alter: true });

    app.listen(PORT, () => {
      console.log(`🚀 Revamped Production Backend is running on port ${PORT}`);
    });
  } catch (error) {
    console.error("❌ Unable to connect to the master database:", error);
    process.exit(1); // Stop the server if the master DB is down
  }
};

startServer();
