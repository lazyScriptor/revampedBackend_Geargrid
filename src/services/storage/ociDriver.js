import crypto from "crypto";
import AppError from "../../utils/AppError.js";

const sha256Hex = (data) => crypto.createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();

const encodeS3Path = (key) =>
  String(key || "")
    .replace(/^\/+/, "")
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");

const formatAmzDate = (date) => {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
};

const getSigningKey = (secretKey, dateStamp, region, service = "s3") => {
  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
};

/**
 * Oracle Cloud Infrastructure (OCI) Object Storage S3-compatible driver.
 * Uses standard AWS SigV4 signing over fetch (zero external SDK dependencies).
 */
export const createOciStorageDriver = ({
  bucket = process.env.OCI_RECORDINGS_BUCKET || "",
  region = process.env.OCI_REGION || "ap-mumbai-1",
  namespace = process.env.OCI_NAMESPACE || "",
  accessKeyId = process.env.OCI_S3_ACCESS_KEY_ID || "",
  secretAccessKey = process.env.OCI_S3_SECRET_ACCESS_KEY || "",
  endpoint = process.env.OCI_S3_ENDPOINT || "",
  fetchImpl = globalThis.fetch,
} = {}) => {
  const resolvedEndpoint =
    endpoint ||
    (namespace
      ? `https://${namespace}.compat.objectstorage.${region}.oraclecloud.com`
      : "");

  const assertConfigured = () => {
    if (!bucket || !resolvedEndpoint || !accessKeyId || !secretAccessKey) {
      throw new AppError("OCI object storage is not configured.", 500, "storage_not_configured");
    }
  };

  const signRequest = ({ method, key, body = null, contentType = null, now = new Date() }) => {
    assertConfigured();
    const url = new URL(`${resolvedEndpoint.replace(/\/+$/, "")}/${encodeURIComponent(bucket)}/${encodeS3Path(key)}`);
    const { amzDate, dateStamp } = formatAmzDate(now);
    const payloadHash = body ? sha256Hex(body) : "UNSIGNED-PAYLOAD";

    const headers = {
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };
    if (contentType) {
      headers["content-type"] = contentType;
    }

    const sortedKeys = Object.keys(headers).sort();
    const canonicalHeaders = sortedKeys.map((k) => `${k}:${headers[k]}\n`).join("");
    const signedHeaders = sortedKeys.join(";");
    const canonicalRequest = [
      method,
      url.pathname,
      "",
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join("\n");

    const signingKey = getSigningKey(secretAccessKey, dateStamp, region);
    const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");
    headers.Authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return { url: url.toString(), headers };
  };

  return {
    driver: "oci",
    bucket,
    region,

    async putObject({ key, buffer, contentType = "application/octet-stream" }) {
      const { url, headers } = signRequest({
        method: "PUT",
        key,
        body: buffer,
        contentType,
      });
      const res = await fetchImpl(url, {
        method: "PUT",
        headers,
        body: buffer,
      });
      if (!res.ok) {
        throw new AppError(`OCI upload failed with status ${res.status}.`, 502);
      }
      return { key, bytes: buffer.length };
    },

    async getSignedUrl({ key, expiresInSeconds = 300, now = new Date() }) {
      assertConfigured();
      const expires = Math.min(3600, Math.max(30, Number(expiresInSeconds) || 300));
      const url = new URL(`${resolvedEndpoint.replace(/\/+$/, "")}/${encodeURIComponent(bucket)}/${encodeS3Path(key)}`);
      const { amzDate, dateStamp } = formatAmzDate(now);
      const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;

      const params = new URLSearchParams({
        "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
        "X-Amz-Credential": `${accessKeyId}/${credentialScope}`,
        "X-Amz-Date": amzDate,
        "X-Amz-Expires": String(expires),
        "X-Amz-SignedHeaders": "host",
      });
      const sortedParams = [...params.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&");

      const canonicalRequest = [
        "GET",
        url.pathname,
        sortedParams,
        `host:${url.host}\n`,
        "host",
        "UNSIGNED-PAYLOAD",
      ].join("\n");

      const stringToSign = [
        "AWS4-HMAC-SHA256",
        amzDate,
        credentialScope,
        sha256Hex(canonicalRequest),
      ].join("\n");

      const signingKey = getSigningKey(secretAccessKey, dateStamp, region);
      const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");
      return `${url.origin}${url.pathname}?${sortedParams}&X-Amz-Signature=${signature}`;
    },

    async getReadStream() {
      return null;
    },

    async deleteObject({ key }) {
      const { url, headers } = signRequest({
        method: "DELETE",
        key,
        body: null,
      });
      const res = await fetchImpl(url, {
        method: "DELETE",
        headers,
      });
      if (!res.ok && res.status !== 404) {
        throw new AppError(`OCI delete failed with status ${res.status}.`, 502);
      }
      return res.status !== 404;
    },
  };
};
