const apiBaseUrl = window.APP_CONFIG?.apiBaseUrl;

if (!apiBaseUrl) {
  throw new Error("APP_CONFIG.apiBaseUrl is required. Configure FRONTEND_API_BASE_URL in .env.");
}

async function parseResponse(response) {
  const text = await response.text();
  let payload = {};

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    throw new Error(typeof payload === "object" ? JSON.stringify(payload) : String(payload));
  }

  return payload;
}

export async function http(path, options = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  return parseResponse(response);
}

export async function httpUpload(path, formData) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    body: formData,
  });

  return parseResponse(response);
}
