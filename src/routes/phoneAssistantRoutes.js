import express from "express";
import { Op } from "sequelize";
import {
  GetPushSettingsContract,
  UpdatePushSettingsContract,
  SendPushTestContract,
  ListShopDevicesContract,
  UpdateShopDeviceContract,
  SetShopDeviceStatusContract,
  WipeShopDeviceContract,
  TestShopDevicePushContract,
  GetShopDeviceAuditContract,
  GetPhoneAssistantPolicyContract,
  UpdatePhoneAssistantPolicyContract,
  PatchPhoneAssistantPolicyContract,
  GetPushTemplatesContract,
  PutPushTemplateContract,
  DeletePushTemplateContract,
  PreviewPushTemplateContract,
  SendCallScreenSampleContract,
  SendPushTemplateTestContract,
} from "@geargrid/contracts";
import { protect } from "../middlewares/authMiddleware.js";
import { requireFeature } from "../middlewares/planMiddleware.js";
import { registerContract } from "../utils/contractAdapter.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import { getMasterModels } from "../models/master/index.js";
import { isUserAdmin, userHasPermission } from "../services/userService.js";
import * as pushEventService from "../services/pushEventService.js";
import * as deviceService from "../services/deviceService.js";
import * as phoneAssistantPolicyService from "../services/phoneAssistantPolicyService.js";
import * as pushTemplateService from "../services/pushTemplateService.js";
import { sendDataPush, sendToUsers } from "../services/devicePushService.js";
import { PUSH_EVENTS_BY_KEY } from "../config/pushEvents.js";
import AppError from "../utils/AppError.js";

const router = express.Router();

const resolveTenantModels = (req) =>
  initTenantModels(getCachedTenantConnection(req.user.tenantDbName));

const loadUserWithPerms = async (models, req) => {
  const userId = req.user?.userId || req.user?.id;
  return models.User.findByPk(userId, {
    attributes: ["user_id", "is_active"],
    include: [
      {
        model: models.Role,
        attributes: ["role_id", "role_name", "hierarchy_level", "is_active"],
        through: { attributes: [] },
        ...(models.Permission
          ? {
              include: [
                {
                  model: models.Permission,
                  attributes: ["permission_code"],
                  through: { attributes: [] },
                },
              ],
            }
          : {}),
      },
    ],
  });
};

const requireAdmin = async (req, _res, next) => {
  try {
    const models = resolveTenantModels(req);
    const user = await loadUserWithPerms(models, req);
    if (!isUserAdmin(user)) {
      return next(new AppError("Administrator access is required.", 403));
    }
    return next();
  } catch (err) {
    return next(err);
  }
};

const requireDevicesManage = async (req, _res, next) => {
  try {
    const models = resolveTenantModels(req);
    const user = await loadUserWithPerms(models, req);
    if (isUserAdmin(user) || (await userHasPermission(models, user, "devices:manage"))) {
      return next();
    }
    return next(new AppError("Permission devices:manage is required.", 403));
  } catch (err) {
    return next(err);
  }
};

router.use(protect);
router.use(requireFeature("phone_assistant"));

registerContract(router, GetPushSettingsContract, {
  basePath: "/phone-assistant",
  middlewares: [requireAdmin],
  handler: ({ req }) => pushEventService.getPushSettings(resolveTenantModels(req)),
});

registerContract(router, UpdatePushSettingsContract, {
  basePath: "/phone-assistant",
  middlewares: [requireAdmin],
  handler: ({ body, req }) =>
    pushEventService.updatePushSettings(resolveTenantModels(req), body),
});

registerContract(router, SendPushTestContract, {
  basePath: "/phone-assistant",
  middlewares: [requireAdmin],
  handler: ({ req }) =>
    pushEventService.sendTestPush(
      resolveTenantModels(req),
      req.user?.userId || req.user?.id,
    ),
});

// ── Release 2 Part B: Shop Device Console & Policy ────────────────────────

registerContract(router, ListShopDevicesContract, {
  basePath: "/phone-assistant",
  middlewares: [requireDevicesManage],
  handler: ({ query, req }) =>
    deviceService.listShopDevices(resolveTenantModels(req), req.user?.tenantDbName, query),
});

registerContract(router, UpdateShopDeviceContract, {
  basePath: "/phone-assistant",
  middlewares: [requireDevicesManage],
  handler: ({ params, body, req }) =>
    deviceService.updateShopDevice(resolveTenantModels(req), params.id, body, req.user),
});

registerContract(router, SetShopDeviceStatusContract, {
  basePath: "/phone-assistant",
  middlewares: [requireDevicesManage],
  handler: ({ params, body, req }) =>
    deviceService.setDeviceStatus(
      resolveTenantModels(req),
      params.id,
      body.status,
      req.user,
      body.reason ?? null,
      getMasterModels(),
    ),
});

registerContract(router, WipeShopDeviceContract, {
  basePath: "/phone-assistant",
  middlewares: [requireDevicesManage],
  handler: ({ params, body, req }) =>
    deviceService.wipeShopDevice(
      resolveTenantModels(req),
      params.id,
      req.user,
      body?.reason ?? null,
    ),
});

registerContract(router, TestShopDevicePushContract, {
  basePath: "/phone-assistant",
  middlewares: [requireDevicesManage],
  handler: ({ params, req }) =>
    deviceService.sendTestPushToDevice(resolveTenantModels(req), params.id),
});

registerContract(router, GetShopDeviceAuditContract, {
  basePath: "/phone-assistant",
  middlewares: [requireDevicesManage],
  handler: ({ params, req }) =>
    deviceService.getShopDeviceAudit(resolveTenantModels(req), params.id),
});

registerContract(router, GetPhoneAssistantPolicyContract, {
  basePath: "/phone-assistant",
  middlewares: [requireDevicesManage],
  handler: ({ req }) =>
    phoneAssistantPolicyService.getPhoneAssistantPolicy(resolveTenantModels(req)),
});

registerContract(router, UpdatePhoneAssistantPolicyContract, {
  basePath: "/phone-assistant",
  middlewares: [requireAdmin],
  handler: ({ body, req }) =>
    phoneAssistantPolicyService.updatePhoneAssistantPolicy(resolveTenantModels(req), body),
});

registerContract(router, PatchPhoneAssistantPolicyContract, {
  basePath: "/phone-assistant", middlewares: [requireAdmin],
  handler: ({ body, req }) => phoneAssistantPolicyService.patchPhoneAssistantPolicy(resolveTenantModels(req), body.updates),
});

registerContract(router, GetPushTemplatesContract, {
  basePath: "/phone-assistant", middlewares: [requireAdmin],
  handler: ({ req }) => pushTemplateService.listTemplates(resolveTenantModels(req)),
});
registerContract(router, PutPushTemplateContract, {
  basePath: "/phone-assistant", middlewares: [requireAdmin],
  handler: ({ params, body, req }) => pushTemplateService.saveTemplate(resolveTenantModels(req), params.event_key, params.language, body, req.user?.userId || req.user?.id),
});
registerContract(router, DeletePushTemplateContract, {
  basePath: "/phone-assistant", middlewares: [requireAdmin],
  handler: ({ params, req }) => pushTemplateService.resetTemplate(resolveTenantModels(req), params.event_key, params.language),
});
registerContract(router, PreviewPushTemplateContract, {
  basePath: "/phone-assistant", middlewares: [requireAdmin],
  handler: async ({ body, req }) => {
    const models = resolveTenantModels(req);
    const { policy } = await phoneAssistantPolicyService.getPhoneAssistantPolicy(models);
    const draft = { ...body };
    return {
      normal: await pushTemplateService.renderDraft(models, body.event_key, draft, policy),
      private: await pushTemplateService.renderDraft(models, body.event_key, draft, policy, { privateMode: true }),
    };
  },
});

registerContract(router, SendPushTemplateTestContract, {
  basePath: "/phone-assistant", middlewares: [requireAdmin],
  handler: async ({ body, req }) => {
    const models = resolveTenantModels(req);
    const { policy } = await phoneAssistantPolicyService.getPhoneAssistantPolicy(models);
    const text = await pushTemplateService.renderDraft(models, body.event_key, body, policy, { privateMode: Boolean(body.private) });
    const userId = req.user?.userId || req.user?.id;
    const res = await sendToUsers(models, [userId], { title: text.title, body: text.body, data: { type: "template_test" }, channel: PUSH_EVENTS_BY_KEY[body.event_key]?.group || "bills" });
    return { reached: Number(res?.reached ?? 0), title: text.title, body: text.body };
  },
});

registerContract(router, SendCallScreenSampleContract, {
  basePath: "/phone-assistant",
  middlewares: [requireAdmin],
  handler: async ({ req }) => {
    const models = resolveTenantModels(req);
    const userId = req.user?.userId || req.user?.id;
    const devices = await models.OperatorDevice.findAll({
      where: { user_id: userId, is_native_app: true, status: "ACTIVE", push_token: { [Op.ne]: null } },
    });
    const results = await Promise.all(
      (devices || []).map((device) => sendDataPush(device, { type: "sample_call" }).catch(() => null)),
    );
    return { reached: results.filter((r) => r && r.sent).length };
  },
});

export default router;
