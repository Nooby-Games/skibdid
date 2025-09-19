const fetch = require("node-fetch");
const { URL } = require("url");

const MAX_BODY_BYTES = 6 * 1024 * 1024;

exports.handler = async function (event, context) {
  try {
    const qs = event.queryStringParameters || {};
    const target = qs.url || qs.target || "";

    if (!target) {
      return { statusCode: 400, body: JSON.stringify({ error: "missing 'url'" }) };
    }

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch (e) {
      return { statusCode: 400, body: JSON.stringify({ error: "invalid URL" }) };
    }

    if (!["http:", "https:"].includes(targetUrl.protocol)) {
      return { statusCode: 400, body: JSON.stringify({ error: "only http(s) URLs allowed" }) };
    }

    const headers = {};
    if (event.headers) {
      if (event.headers["user-agent"]) headers["user-agent"] = event.headers["user-agent"];
      if (event.headers["accept"]) headers["accept"] = event.headers["accept"];
    }

    const res = await fetch(targetUrl.toString(), { method: "GET", headers, redirect: "follow" });

    const buffer = await res.buffer();
    if (buffer.length > MAX_BODY_BYTES) {
      return { statusCode: 413, body: JSON.stringify({ error: "too large", size: buffer.length }) };
    }

    const disallowed = new Set(["transfer-encoding","connection","keep-alive","proxy-authenticate","proxy-authorization","te","trailer","upgrade","set-cookie"]);
    const responseHeaders = {};
    res.headers.forEach((val, key) => {
      if (!disallowed.has(key.toLowerCase())) responseHeaders[key] = val;
    });

    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("text/html")) {
      let text = buffer.toString("utf8");
      text = text.replace(/(src|href)=(["'])([^"'>]+)\2/gi, (m, p1, p2, p3) => {
        if (/^(data:|javascript:|mailto:|#)/i.test(p3)) return m;
        try {
          const resolved = new URL(p3, targetUrl).toString();
          return `${p1}=${p2}/proxy?url=${encodeURIComponent(resolved)}${p2}`;
        } catch { return m; }
      });
      return { statusCode: 200, headers: { ...responseHeaders, "content-type": "text/html" }, body: text };
    }

    const isText = contentType.startsWith("text/") || contentType.includes("json") || contentType.includes("xml");
    if (isText) {
      return { statusCode: res.status, headers: responseHeaders, body: buffer.toString("utf8") };
    } else {
      return { statusCode: res.status, headers: { ...responseHeaders, "content-type": res.headers.get("content-type") || "application/octet-stream" }, isBase64Encoded: true, body: buffer.toString("base64") };
    }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: "proxy error", message: String(err) }) };
  }
};
