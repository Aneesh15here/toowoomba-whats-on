export function requirementsFor(type) {
  switch (type) {
    case "garage-sale":
      return { startTime: true, items: true };
    case "event":
      return { startTime: true, items: false };
    case "notice":
      return { startTime: false, items: false };
    default:
      return { startTime: false, items: false };
  }
}

const PAYLOAD_FIELDS = [
  "type",
  "title",
  "date",
  "start_time",
  "end_time",
  "venue",
  "suburb_or_address",
  "price",
  "age_group",
  "community",
  "category",
  "items",
  "source_link",
  "message",
  "hp_field",
];

export function payloadFromForm(form) {
  const data = {};
  for (const name of PAYLOAD_FIELDS) {
    const field = form.elements.namedItem(name);
    data[name] = field ? String(field.value || "") : "";
  }
  return JSON.stringify(data);
}

function setRequired(field, required, minLength) {
  field.required = required;
  field.minLength = minLength;
}

function initShareForm() {
  const form = document.querySelector("#share-form");
  if (!(form instanceof HTMLFormElement)) return;

  const page = document.querySelector("#share-page");
  const subject = document.querySelector("#share-subject");
  const next = document.querySelector("#share-next");
  const payload = document.querySelector("#share-payload");
  const typeInput = form.elements.namedItem("type");
  const startTime = form.elements.namedItem("start_time");
  const items = form.elements.namedItem("items");

  const syncTypeFields = () => {
    const rules = requirementsFor(typeInput.value);
    setRequired(startTime, rules.startTime, 0);
    setRequired(items, rules.items, rules.items ? 3 : 0);
  };

  page.value = window.location.href;
  next.value = new URL("thanks.html", window.location.href).href;
  typeInput.addEventListener("change", syncTypeFields);
  syncTypeFields();

  form.addEventListener("submit", () => {
    const type = typeInput.value;
    const title = form.elements.namedItem("title").value.trim();
    subject.value = `What's On Toowoomba: ${type}: ${title}`.slice(0, 180);
    next.value = new URL("thanks.html", window.location.href).href;
    page.value = window.location.href;
    payload.value = payloadFromForm(form);
  });
}

if (typeof document !== "undefined") initShareForm();
