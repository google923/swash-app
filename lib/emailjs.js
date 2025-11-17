const EMAILJS_API_URL = "https://api.emailjs.com/api/v1.0/email/send";
const EMAILJS_SERVICE_ID = "service_cdy739m";
const DEFAULT_PUBLIC_KEY = "7HZRYXz3JmMciex1L";

const EMAILJS_PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY || DEFAULT_PUBLIC_KEY;

function ensureFetch() {
  if (typeof fetch === "function") {
    return fetch;
  }
  throw new Error("Fetch API is not available in this runtime");
}

/**
 * Dispatch an EmailJS template using the public REST API.
 * @param {string} templateId
 * @param {Record<string, any>} templateParams
 */
export async function sendEmailJsTemplate(templateId, templateParams = {}) {
  if (!templateId) {
    throw new Error("EmailJS templateId is required");
  }
  const fetchImpl = ensureFetch();
  const payload = {
    service_id: EMAILJS_SERVICE_ID,
    template_id: templateId,
    user_id: EMAILJS_PUBLIC_KEY,
    template_params: templateParams,
  };
  const response = await fetchImpl(EMAILJS_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`EmailJS request failed (${response.status}): ${details}`);
  }
  return true;
}

export { EMAILJS_SERVICE_ID, EMAILJS_PUBLIC_KEY };
