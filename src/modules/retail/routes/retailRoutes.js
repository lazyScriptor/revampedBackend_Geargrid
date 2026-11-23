import express from "express";
import { protect, requirePermission } from "../../../middlewares/authMiddleware.js";
import { requireFeature } from "../../../middlewares/planMiddleware.js";
import { getCachedTenantConnection } from "../../../config/database.js";
import { initTenantModels } from "../../../models/index.js";
import catchAsync from "../../../utils/catchAsync.js";
import { ensureWalkInCustomer } from "../walkInService.js";
import { getRetailSettings, updateRetailSettings } from "../retailSettingsService.js";
import {
  createAndLinkUnlistedSaleLines,
  linkUnlistedSaleLines,
  markUnlistedOneOff,
} from "../sales/saleLinesService.js";
import {
  addFamilyVariants,
  archiveProduct,
  createAlias,
  createBrand,
  createCategory,
  createFamily,
  createProduct,
  deleteAlias,
  deleteCategory,
  getPosCatalog,
  getProductById,
  learnBarcode,
  listAliases,
  listBrands,
  listCategoriesTree,
  listProducts,
  lookupProductByCode,
  mergeCategoryInto,
  stripCostFields,
  updateAlias,
  updateBrand,
  updateCategory,
  updateFamily,
  updateProduct,
  userCanViewRetailCost,
} from "../catalog/catalogService.js";
import { browseFinder, searchFinder } from "../catalog/finderService.js";
import {
  checkStockIntegrity,
  createReceiveDocument,
  deleteReceiveDraft,
  getStockDocumentById,
  getStockLevelsDelta,
  getStockSummary,
  getSupplierItems,
  listSerials,
  listStockDocuments,
  listStockMovements,
  listSuppliers,
  postAdjustDocument,
  postCountDocument,
  postOpeningDocument,
  postReceiveDocument,
  updateReceiveDraft,
  updateStockLevelThresholds,
} from "../stock/stockService.js";

const router = express.Router();

const getModels = (req) =>
  initTenantModels(getCachedTenantConnection(req.user.tenantDbName));

const canViewCost = (req, models) =>
  userCanViewRetailCost(models, req.user?.userId, req.effectivePermissions);

router.use(protect, requireFeature("retail"));

router
  .route("/settings")
  .get(
    requirePermission("retail:view"),
    catchAsync(async (req, res) => {
      const settings = await getRetailSettings(getModels(req));
      res.status(200).json({ status: "success", data: { settings } });
    }),
  )
  .put(
    requirePermission("config:manage"),
    catchAsync(async (req, res) => {
      const settings = await updateRetailSettings(getModels(req), req.body);
      res.status(200).json({ status: "success", data: { settings } });
    }),
  );

router.get(
  "/walk-in",
  requirePermission("retail:sell"),
  catchAsync(async (req, res) => {
    const customer = await ensureWalkInCustomer(getModels(req));
    res.status(200).json({ status: "success", data: { customer } });
  }),
);

// ── Products ────────────────────────────────────────────────────────────────
router.get(
  "/products/lookup",
  requirePermission("retail:sell"),
  catchAsync(async (req, res) => {
    const models = getModels(req);
    const [result, showCost] = await Promise.all([
      lookupProductByCode(models, req.query.code),
      canViewCost(req, models),
    ]);
    res.status(200).json({
      status: "success",
      data: stripCostFields(result, showCost),
    });
  }),
);

router
  .route("/products")
  .get(
    requirePermission("retail:view"),
    catchAsync(async (req, res) => {
      const models = getModels(req);
      const [result, showCost] = await Promise.all([
        listProducts(models, req.query),
        canViewCost(req, models),
      ]);
      res.status(200).json({
        status: "success",
        data: stripCostFields(result, showCost),
      });
    }),
  )
  .post(
    requirePermission("retail:product_manage"),
    catchAsync(async (req, res) => {
      const models = getModels(req);
      const [product, showCost] = await Promise.all([
        createProduct(models, req.user?.userId, req.body),
        canViewCost(req, models),
      ]);
      res.status(201).json({
        status: "success",
        data: { product: stripCostFields(product, showCost) },
      });
    }),
  );

router
  .route("/products/:id")
  .get(
    requirePermission("retail:view"),
    catchAsync(async (req, res) => {
      const models = getModels(req);
      const [product, showCost] = await Promise.all([
        getProductById(models, req.params.id),
        canViewCost(req, models),
      ]);
      res.status(200).json({
        status: "success",
        data: { product: stripCostFields(product, showCost) },
      });
    }),
  )
  .put(
    requirePermission("retail:product_manage"),
    catchAsync(async (req, res) => {
      const models = getModels(req);
      const [product, showCost] = await Promise.all([
        updateProduct(models, req.params.id, req.body),
        canViewCost(req, models),
      ]);
      res.status(200).json({
        status: "success",
        data: { product: stripCostFields(product, showCost) },
      });
    }),
  );

router.post(
  "/products/:id/archive",
  requirePermission("retail:product_manage"),
  catchAsync(async (req, res) => {
    const models = getModels(req);
    const [product, showCost] = await Promise.all([
      archiveProduct(models, req.params.id, req.body || {}),
      canViewCost(req, models),
    ]);
    res.status(200).json({
      status: "success",
      data: { product: stripCostFields(product, showCost) },
    });
  }),
);

// ── Families ────────────────────────────────────────────────────────────────
router.post(
  "/families",
  requirePermission("retail:product_manage"),
  catchAsync(async (req, res) => {
    const models = getModels(req);
    const [result, showCost] = await Promise.all([
      createFamily(models, req.user?.userId, req.body),
      canViewCost(req, models),
    ]);
    res.status(201).json({
      status: "success",
      data: stripCostFields(result, showCost),
    });
  }),
);

router.put(
  "/families/:id",
  requirePermission("retail:product_manage"),
  catchAsync(async (req, res) => {
    const family = await updateFamily(getModels(req), req.params.id, req.body);
    res.status(200).json({ status: "success", data: { family } });
  }),
);

router.post(
  "/families/:id/variants",
  requirePermission("retail:product_manage"),
  catchAsync(async (req, res) => {
    const models = getModels(req);
    const [result, showCost] = await Promise.all([
      addFamilyVariants(models, req.params.id, req.user?.userId, req.body),
      canViewCost(req, models),
    ]);
    res.status(201).json({
      status: "success",
      data: stripCostFields(result, showCost),
    });
  }),
);

// ── Categories ──────────────────────────────────────────────────────────────
router
  .route("/categories")
  .get(
    requirePermission("retail:view"),
    catchAsync(async (req, res) => {
      const categories = await listCategoriesTree(getModels(req));
      res.status(200).json({ status: "success", data: { categories } });
    }),
  )
  .post(
    requirePermission("retail:product_manage"),
    catchAsync(async (req, res) => {
      const category = await createCategory(getModels(req), req.body);
      res.status(201).json({ status: "success", data: { category } });
    }),
  );

router
  .route("/categories/:id")
  .put(
    requirePermission("retail:product_manage"),
    catchAsync(async (req, res) => {
      const category = await updateCategory(getModels(req), req.params.id, req.body);
      res.status(200).json({ status: "success", data: { category } });
    }),
  )
  .delete(
    requirePermission("retail:product_manage"),
    catchAsync(async (req, res) => {
      const result = await deleteCategory(getModels(req), req.params.id);
      res.status(200).json({ status: "success", data: result });
    }),
  );

router.post(
  "/categories/:id/merge-into/:targetId",
  requirePermission("retail:product_manage"),
  catchAsync(async (req, res) => {
    const result = await mergeCategoryInto(
      getModels(req),
      req.params.id,
      req.params.targetId,
    );
    res.status(200).json({ status: "success", data: result });
  }),
);

// ── Brands ──────────────────────────────────────────────────────────────────
router
  .route("/brands")
  .get(
    requirePermission("retail:view"),
    catchAsync(async (req, res) => {
      const brands = await listBrands(getModels(req));
      res.status(200).json({ status: "success", data: { brands } });
    }),
  )
  .post(
    requirePermission("retail:product_manage"),
    catchAsync(async (req, res) => {
      const brand = await createBrand(getModels(req), req.body);
      res.status(201).json({ status: "success", data: { brand } });
    }),
  );

router.put(
  "/brands/:id",
  requirePermission("retail:product_manage"),
  catchAsync(async (req, res) => {
    const brand = await updateBrand(getModels(req), req.params.id, req.body);
    res.status(200).json({ status: "success", data: { brand } });
  }),
);

// ── Search Aliases ──────────────────────────────────────────────────────────
router
  .route("/aliases")
  .get(
    requirePermission("retail:view"),
    catchAsync(async (req, res) => {
      const aliases = await listAliases(getModels(req));
      res.status(200).json({ status: "success", data: { aliases } });
    }),
  )
  .post(
    requirePermission("retail:product_manage"),
    catchAsync(async (req, res) => {
      const alias = await createAlias(getModels(req), req.body);
      res.status(201).json({ status: "success", data: { alias } });
    }),
  );

router
  .route("/aliases/:id")
  .put(
    requirePermission("retail:product_manage"),
    catchAsync(async (req, res) => {
      const alias = await updateAlias(getModels(req), req.params.id, req.body);
      res.status(200).json({ status: "success", data: { alias } });
    }),
  )
  .delete(
    requirePermission("retail:product_manage"),
    catchAsync(async (req, res) => {
      const result = await deleteAlias(getModels(req), req.params.id);
      res.status(200).json({ status: "success", data: result });
    }),
  );

// ── Finder & Barcodes & POS Catalog ─────────────────────────────────────────
router.get(
  "/finder/search",
  requirePermission("retail:view"),
  catchAsync(async (req, res) => {
    const data = await searchFinder(getModels(req), req.query);
    res.status(200).json({ status: "success", data });
  }),
);

router.get(
  "/finder/browse",
  requirePermission("retail:view"),
  catchAsync(async (req, res) => {
    const data = await browseFinder(getModels(req), req.query);
    res.status(200).json({ status: "success", data });
  }),
);

router.post(
  "/barcodes",
  requirePermission("retail:stock_receive", "retail:product_manage"),
  catchAsync(async (req, res) => {
    const barcode = await learnBarcode(getModels(req), req.body);
    res.status(201).json({ status: "success", data: { barcode } });
  }),
);

router.get(
  "/pos/catalog",
  requirePermission("retail:sell"),
  catchAsync(async (req, res) => {
    const models = getModels(req);
    const [catalog, showCost] = await Promise.all([
      getPosCatalog(models, req.query),
      canViewCost(req, models),
    ]);
    res.status(200).json({
      status: "success",
      data: stripCostFields(catalog, showCost),
    });
  }),
);

// ── Stock Receiving, Adjustments, Counts & Opening (R2) ─────────────────────
router.post(
  "/stock/receive",
  requirePermission("retail:stock_receive"),
  catchAsync(async (req, res) => {
    const models = getModels(req);
    const [document, showCost] = await Promise.all([
      createReceiveDocument(models, req.user?.userId, req.body || {}, {
        effectivePermissions: req.effectivePermissions,
      }),
      canViewCost(req, models),
    ]);
    res.status(201).json({
      status: "success",
      data: { document: stripCostFields(document, showCost) },
    });
  }),
);

router
  .route("/stock/receive/:id")
  .put(
    requirePermission("retail:stock_receive"),
    catchAsync(async (req, res) => {
      const models = getModels(req);
      const [document, showCost] = await Promise.all([
        updateReceiveDraft(models, req.params.id, req.user?.userId, req.body || {}, {
          effectivePermissions: req.effectivePermissions,
        }),
        canViewCost(req, models),
      ]);
      res.status(200).json({
        status: "success",
        data: { document: stripCostFields(document, showCost) },
      });
    }),
  )
  .delete(
    requirePermission("retail:stock_receive"),
    catchAsync(async (req, res) => {
      const result = await deleteReceiveDraft(getModels(req), req.params.id);
      res.status(200).json({ status: "success", data: result });
    }),
  );

router.post(
  "/stock/receive/:id/post",
  requirePermission("retail:stock_receive"),
  catchAsync(async (req, res) => {
    const models = getModels(req);
    const [document, showCost] = await Promise.all([
      postReceiveDocument(models, req.params.id, req.user?.userId, req.body || {}, {
        effectivePermissions: req.effectivePermissions,
      }),
      canViewCost(req, models),
    ]);
    res.status(200).json({
      status: "success",
      data: { document: stripCostFields(document, showCost) },
    });
  }),
);

router.post(
  "/stock/adjust",
  requirePermission("retail:stock_adjust"),
  catchAsync(async (req, res) => {
    const models = getModels(req);
    const [document, showCost] = await Promise.all([
      postAdjustDocument(models, req.user?.userId, req.body || {}, {
        effectivePermissions: req.effectivePermissions,
      }),
      canViewCost(req, models),
    ]);
    res.status(201).json({
      status: "success",
      data: { document: stripCostFields(document, showCost) },
    });
  }),
);

router.post(
  "/stock/count",
  requirePermission("retail:stock_adjust"),
  catchAsync(async (req, res) => {
    const models = getModels(req);
    const [document, showCost] = await Promise.all([
      postCountDocument(models, req.user?.userId, req.body || {}, {
        effectivePermissions: req.effectivePermissions,
      }),
      canViewCost(req, models),
    ]);
    res.status(201).json({
      status: "success",
      data: { document: stripCostFields(document, showCost) },
    });
  }),
);

router.post(
  "/stock/opening",
  requirePermission("retail:stock_adjust"),
  catchAsync(async (req, res) => {
    const models = getModels(req);
    const [document, showCost] = await Promise.all([
      postOpeningDocument(models, req.user?.userId, req.body || {}, {
        effectivePermissions: req.effectivePermissions,
      }),
      canViewCost(req, models),
    ]);
    res.status(201).json({
      status: "success",
      data: { document: stripCostFields(document, showCost) },
    });
  }),
);

// ── Stock Lists, Levels, Movements, Summary, Serials & Integrity ────────────
router.get(
  "/stock/documents",
  requirePermission("retail:view"),
  catchAsync(async (req, res) => {
    const models = getModels(req);
    const [result, showCost] = await Promise.all([
      listStockDocuments(models, req.query),
      canViewCost(req, models),
    ]);
    res.status(200).json({
      status: "success",
      data: stripCostFields(result, showCost),
    });
  }),
);

router.get(
  "/stock/documents/:id",
  requirePermission("retail:view"),
  catchAsync(async (req, res) => {
    const models = getModels(req);
    const [document, showCost] = await Promise.all([
      getStockDocumentById(models, req.params.id),
      canViewCost(req, models),
    ]);
    res.status(200).json({
      status: "success",
      data: { document: stripCostFields(document, showCost) },
    });
  }),
);

router.get(
  "/stock/suppliers",
  requirePermission("retail:view"),
  catchAsync(async (req, res) => {
    const suppliers = await listSuppliers(getModels(req), req.query);
    res.status(200).json({ status: "success", data: { suppliers } });
  }),
);

router.get(
  "/finder/supplier-items",
  requirePermission("retail:stock_receive"),
  catchAsync(async (req, res) => {
    const models = getModels(req);
    const [items, showCost] = await Promise.all([
      getSupplierItems(models, req.query),
      canViewCost(req, models),
    ]);
    res.status(200).json({
      status: "success",
      data: { items: stripCostFields(items, showCost) },
    });
  }),
);

router.get(
  "/stock/levels",
  requirePermission("retail:view"),
  catchAsync(async (req, res) => {
    const data = await getStockLevelsDelta(getModels(req), req.query);
    res.status(200).json({ status: "success", data });
  }),
);

router.put(
  "/stock/levels/:productId/:warehouseId",
  requirePermission("retail:product_manage"),
  catchAsync(async (req, res) => {
    const level = await updateStockLevelThresholds(
      getModels(req),
      req.params.productId,
      req.params.warehouseId,
      req.body || {},
    );
    res.status(200).json({ status: "success", data: { level } });
  }),
);

router.get(
  "/stock/movements",
  requirePermission("retail:view"),
  catchAsync(async (req, res) => {
    const models = getModels(req);
    const [result, showCost] = await Promise.all([
      listStockMovements(models, req.query),
      canViewCost(req, models),
    ]);
    res.status(200).json({
      status: "success",
      data: stripCostFields(result, showCost),
    });
  }),
);

router.get(
  "/stock/summary",
  requirePermission("retail:view"),
  catchAsync(async (req, res) => {
    const models = getModels(req);
    const [summary, showCost] = await Promise.all([
      getStockSummary(models, req.query),
      canViewCost(req, models),
    ]);
    res.status(200).json({
      status: "success",
      data: stripCostFields(summary, showCost),
    });
  }),
);

router.get(
  "/stock/integrity",
  requirePermission("config:manage"),
  catchAsync(async (req, res) => {
    const result = await checkStockIntegrity(getModels(req));
    res.status(200).json({ status: "success", data: result });
  }),
);

router.get(
  "/serials",
  requirePermission("retail:view"),
  catchAsync(async (req, res) => {
    const serials = await listSerials(getModels(req), req.query);
    res.status(200).json({ status: "success", data: { serials } });
  }),
);

router.post(
  "/desk/unlisted/link",
  requirePermission("retail:confirm_unlisted"),
  catchAsync(async (req, res) => {
    const result = await linkUnlistedSaleLines(getModels(req), {
      saleLineIds: req.body?.sale_line_ids,
      productId: req.body?.product_id,
      warehouseId: req.body?.warehouse_id ?? null,
      approvals: req.body?.approval_tokens,
      userId: req.user.userId,
    });
    res.status(200).json({ status: "success", data: result });
  }),
);

router.post(
  "/desk/unlisted/create",
  requirePermission("retail:confirm_unlisted"),
  catchAsync(async (req, res) => {
    const result = await createAndLinkUnlistedSaleLines(getModels(req), {
      saleLineIds: req.body?.sale_line_ids,
      productPayload: req.body?.product || req.body,
      openingQty: req.body?.opening_qty ?? null,
      openingCost: req.body?.opening_cost ?? null,
      warehouseId: req.body?.warehouse_id ?? null,
      approvals: req.body?.approval_tokens,
      userId: req.user.userId,
    });
    res.status(201).json({ status: "success", data: result });
  }),
);

router.post(
  "/desk/unlisted/one-off",
  requirePermission("retail:confirm_unlisted"),
  catchAsync(async (req, res) => {
    const result = await markUnlistedOneOff(getModels(req), {
      saleLineIds: req.body?.sale_line_ids,
      userId: req.user.userId,
    });
    res.status(200).json({ status: "success", data: result });
  }),
);

export default router;
