export const FEEDBACK_ADDRESS = "whatsontoowoomba@agentmail.to";
export const FEEDBACK_TYPES = ["suggestion", "problem", "event correction", "other"];

export function feedbackMailto({ type, message, email } = {}) {
  const kind = FEEDBACK_TYPES.includes(type) ? type : "other";
  const subject = `Site feedback: ${kind}`;
  const reply = String(email || "").trim();
  const lines = [`Type: ${kind}`];
  if (reply) lines.push(`Email: ${reply}`);
  lines.push("", String(message || "").trim());
  const body = lines.join("\n");
  return `mailto:${FEEDBACK_ADDRESS}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function bindFeedbackForm(form, navigate) {
  const openDraft = navigate || ((href) => {
    window.location.href = href;
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (typeof form.reportValidity === "function" && !form.reportValidity()) return;
    const data = new FormData(form);
    openDraft(feedbackMailto({
      type: String(data.get("type") || ""),
      message: String(data.get("message") || ""),
      email: String(data.get("email") || ""),
    }));
  });
}

if (typeof document !== "undefined") {
  const form = document.querySelector("#feedback-form");
  if (form) bindFeedbackForm(form);
}
