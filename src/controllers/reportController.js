import * as reportService from "../services/reportService.js";
import * as pdfService from "../services/pdfService.js";
import * as excelService from "../services/excelService.js";
import { getCachedTenantConnection } from "../config/database.js";
import { initTenantModels } from "../models/index.js";
import catchAsync from "../utils/catchAsync.js";

const getModels = (req) => {
  const connection = getCachedTenantConnection(req.user.tenantDbName);
  return initTenantModels(connection);
};

// --- Helper: Get tenant config for PDF headers ---
const getTenantConfig = async (models) => {
  const config = await models.TenantConfig.findOne({ raw: true });
  return config;
};

// ============================================================================
// 1. DASHBOARD KPIs
// ============================================================================
export const getDashboard = catchAsync(async (req, res) => {
  const data = await reportService.getDashboardKPIs(getModels(req), req.query);
  res.status(200).json({ status: "success", data });
});

// ============================================================================
// 2. PROFIT & LOSS
// ============================================================================
export const getProfitLoss = catchAsync(async (req, res) => {
  const { startDate, endDate } = req.query;
  const data = await reportService.getProfitAndLoss(getModels(req), { startDate, endDate });
  res.status(200).json({ status: "success", data });
});

export const getProfitLossPdf = catchAsync(async (req, res) => {
  const models = getModels(req);
  const { startDate, endDate } = req.query;
  const data = await reportService.getProfitAndLoss(models, { startDate, endDate });
  const tenantConfig = await getTenantConfig(models);
  const docDef = await pdfService.generateProfitLossPdf(data, tenantConfig);
  const buffer = await pdfService.createPdfBuffer(docDef);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename=PnL_${startDate}_${endDate}.pdf`);
  res.send(buffer);
});

export const getProfitLossExcel = catchAsync(async (req, res) => {
  const models = getModels(req);
  const { startDate, endDate } = req.query;
  const data = await reportService.getProfitAndLoss(models, { startDate, endDate });
  const tenantConfig = await getTenantConfig(models);
  const workbook = await excelService.generateProfitLossExcel(data, tenantConfig);

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename=PnL_${startDate}_${endDate}.xlsx`);
  await workbook.xlsx.write(res);
  res.end();
});

// ============================================================================
// 3. ACCOUNTS RECEIVABLE
// ============================================================================
export const getAccountsReceivable = catchAsync(async (req, res) => {
  const data = await reportService.getAccountsReceivable(getModels(req));
  res.status(200).json({ status: "success", data });
});

export const getAccountsReceivablePdf = catchAsync(async (req, res) => {
  const models = getModels(req);
  const data = await reportService.getAccountsReceivable(models);
  const tenantConfig = await getTenantConfig(models);
  const docDef = await pdfService.generateAccountsReceivablePdf(data, tenantConfig);
  const buffer = await pdfService.createPdfBuffer(docDef);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "attachment; filename=AccountsReceivable.pdf");
  res.send(buffer);
});

export const getAccountsReceivableExcel = catchAsync(async (req, res) => {
  const models = getModels(req);
  const data = await reportService.getAccountsReceivable(models);
  const tenantConfig = await getTenantConfig(models);
  const workbook = await excelService.generateAccountsReceivableExcel(data, tenantConfig);

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=AccountsReceivable.xlsx");
  await workbook.xlsx.write(res);
  res.end();
});

// ============================================================================
// 4. EQUIPMENT UTILIZATION
// ============================================================================
export const getEquipmentUtilization = catchAsync(async (req, res) => {
  const { startDate, endDate } = req.query;
  const data = await reportService.getEquipmentUtilization(getModels(req), { startDate, endDate });
  res.status(200).json({ status: "success", data });
});

export const getEquipmentUtilizationExcel = catchAsync(async (req, res) => {
  const models = getModels(req);
  const { startDate, endDate } = req.query;
  const data = await reportService.getEquipmentUtilization(models, { startDate, endDate });
  const tenantConfig = await getTenantConfig(models);
  const workbook = await excelService.generateUtilizationExcel(data, tenantConfig);

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=EquipmentUtilization.xlsx");
  await workbook.xlsx.write(res);
  res.end();
});

// ============================================================================
// 5. MAINTENANCE COST ANALYSIS
// ============================================================================
export const getMaintenanceCosts = catchAsync(async (req, res) => {
  const { startDate, endDate } = req.query;
  const data = await reportService.getMaintenanceCostAnalysis(getModels(req), { startDate, endDate });
  res.status(200).json({ status: "success", data });
});

// ============================================================================
// 6. DAILY CASH FLOW
// ============================================================================
export const getCashFlow = catchAsync(async (req, res) => {
  const data = await reportService.getDailyCashFlow(getModels(req), { date: req.query.date });
  res.status(200).json({ status: "success", data });
});
