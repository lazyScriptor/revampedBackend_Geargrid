import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { User, Role, UserRoleMap } from "../models/index.js";
import AppError from "../utils/AppError.js";

export const loginUser = async (username, password, roleName) => {
  const user = await User.findOne({
    where: { username },
    include: [
      {
        model: Role,
        where: { ur_role: roleName },
        through: { attributes: ["urm_password"] },
      },
    ],
  });

  if (!user || user.Roles.length === 0) {
    throw new AppError("Incorrect username or role", 401);
  }

  const hashedPassword = user.Roles[0].UserRoleMap.urm_password;
  const isPasswordValid = await bcrypt.compare(password, hashedPassword);

  if (!isPasswordValid) throw new AppError("Incorrect password", 401);

  // Generate BOTH Tokens
  const accessToken = jwt.sign(
    { userRole: roleName, username: user.username },
    process.env.JWT_SECRET || "fallback_secret",
    { expiresIn: "15m" }, // 15 Minutes
  );

  const refreshToken = jwt.sign(
    { userRole: roleName, username: user.username },
    process.env.JWT_REFRESH_SECRET || "fallback_refresh_secret",
    { expiresIn: "7d" }, // 7 Days
  );

  return {
    accessToken,
    refreshToken,
    result: roleName,
    username: user.username,
  };
};

export const getUserRoles = async (username) => {
  const user = await User.findOne({
    where: { username },
    include: [
      {
        model: Role,
        attributes: ["ur_role"],
        through: { attributes: [] }, // We don't need the junction table data here
      },
    ],
  });

  if (!user) return []; // Return empty array if user doesn't exist

  // Format to match your old raw SQL output for the frontend
  return user.Roles.map((role) => ({ ur_role: role.ur_role }));
};
