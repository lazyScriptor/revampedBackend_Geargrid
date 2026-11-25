import { createLocalStorageDriver } from "./localDriver.js";
import { createOciStorageDriver } from "./ociDriver.js";

export const getRecordingStorage = (opts = {}) => {
  const driver =
    opts.driver ||
    process.env.CALL_RECORDINGS_STORAGE_DRIVER ||
    (process.env.OCI_RECORDINGS_BUCKET && process.env.OCI_S3_ACCESS_KEY_ID ? "oci" : "local");

  if (driver === "oci") {
    return createOciStorageDriver(opts);
  }
  return createLocalStorageDriver(opts);
};
