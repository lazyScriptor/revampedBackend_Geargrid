import express from "express";
import {
  GetPushSettingsContract,
  UpdatePushSettingsContract,
  SendPushTestContract,
} from "@geargrid/contracts";
import { protect } from "../middlewares/authMiddleware.js";
import { requireFeature } from "../middlewares/planMiddleware.js";
import { registerContract } from "../utils/contractAdapter.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import { isUserAdmin } from "../services/userService.js";
import * as pushEventService from "../services/pushEventService.js";
import AppError from "../utils/AppError.js";

const router = express.Router();

const resolveTenantModels = (req) =>
  initTenantModels(getCachedTenantConnection(req.user.tenantDbName));

const requireAdmin = async (req, _res, next) => {
  try {
    const models = resolveTenantModels(req);
    const userId = req.user?.userId || req.user?.id;
    const user = await models.User.findByPk(userId, {
      attributes: ["user_id", "is_active"],
      include: [
        {
          model: models.Role,
          attributes: ["role_id", "role_name", "hierarchy_level", "is_active"],
          through: { attributes: [] },
        },
      ],
    });
    if (!isUserAdmin(user)) {
      return next(new AppError("Administrator access is required.", 403));
    }
    return next();
  } catch (err) {
    return next(err);
  }
};

router.use(protect);
router.use(requireFeature("phone_assistant"));
router.use(requireAdmin);

registerContract(router, GetPushSettingsContract, {
  basePath: "/phone-assistant",
  handler: ({ req }) => pushEventService.getPushSettings(resolveTenantModels(req)),
});

registerContract(router, UpdatePushSettingsContract, {
  basePath: "/phone-assistant",
  handler: ({ body, req }) =>
    pushEventService.updatePushSettings(resolveTenantModels(req), body),
});

registerContract(router, SendPushTestContract, {
  basePath: "/phone-assistant",
  handler: ({ req }) =>
    pushEventService.sendTestPush(
      resolveTenantModels(req),
      req.user?.userId || req.user?.id,
    ),
});

export default router;
