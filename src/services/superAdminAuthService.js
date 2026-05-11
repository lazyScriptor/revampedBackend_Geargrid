import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { getMasterModels } from "../models/master/index.js";
import AppError from "../utils/AppError.js";

const SUPER_ADMIN_SECRET =
  process.env.SUPER_ADMIN_JWT_SECRET || process.env.JWT_SECRET;

export const loginSuperAdmin = async (email, password) => {
  const { SuperAdmin } = getMasterModels();

  const admin = await SuperAdmin.findOne({ where: { email } });
  if (!admin) {
    throw new AppError("Invalid Super Admin credentials.", 401);
  }

  if (!admin.is_active) {
    throw new AppError("Super Admin account is disabled.", 403);
  }

  const isValid = await bcrypt.compare(password, admin.password_hash);
  if (!isValid) {
    throw new AppError("Invalid Super Admin credentials.", 401);
  }

  const token = jwt.sign(
    {
      superAdminId: admin.super_admin_id,
      email: admin.email,
      displayName: admin.display_name,
      isSuperAdmin: true,
    },
    SUPER_ADMIN_SECRET,
    { expiresIn: "8h" },
  );

  return {
    token,
    admin: {
      id: admin.super_admin_id,
      email: admin.email,
      displayName: admin.display_name,
    },
  };
};
