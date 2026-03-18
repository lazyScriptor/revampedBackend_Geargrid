import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { User, Role, UserRoleMap } from "../models/index.js";
import AppError from "../utils/AppError.js";

export const loginUser = async (username, password, roleName) => {
  // 1. Find user and include their roles
  const user = await User.findOne({
    where: { username },
    include: [
      {
        model: Role,
        where: { ur_role: roleName },
        through: { attributes: ["urm_password"] }, // Fetch the password from the map table
      },
    ],
  });

  if (!user || user.Roles.length === 0) {
    throw new AppError("Incorrect username or role", 401);
  }

  // 2. Extract hashed password from the junction table
  const hashedPassword = user.Roles[0].UserRoleMap.urm_password;

  // 3. Verify password
  const isPasswordValid = await bcrypt.compare(password, hashedPassword);
  if (!isPasswordValid) {
    throw new AppError("Incorrect password", 401);
  }

  // 4. Generate JWT
  const token = jwt.sign(
    { userRole: roleName },
    process.env.JWT_SECRET || "fallback_secret",
    { expiresIn: "1d" }, // '1d' is the same as 60 * 60 * 24
  );

  return {
    token,
    result: roleName,
    username: user.username,
  };
};
