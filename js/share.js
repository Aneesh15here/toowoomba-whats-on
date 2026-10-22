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

function showError(field) {
  const label = field.closest("label");
  if (!label) return;
  let error = label.querySelector(".field-error");
  if (!error) {
    error = document.createElement("span");
    error.className = "field-error";
    error.id = `${field.name}-error`;
    label.append(error);
  }
  error.textContent = field.validity.valueMissing ? "Required." : field.validationMessage;
  field.setAttribute("aria-invalid", "true");
  field.setAttribute("aria-describedby", error.id);
}

function clearError(field) {
  const label = field.closest("label");
  if (!label) return;
  label.querySelector(".field-error")?.remove();
  field.removeAttribute("aria-invalid");
  field.removeAttribute("aria-describedby");
}

function setRequired(field, required) {
  const label = field.closest("label");
  field.required = required;
  label?.classList.toggle("is-required", required);
  if (!required) clearError(field);
}

function initShareForm() {
  const form = document.querySelector("#share-form");
  if (!(form instanceof HTMLFormElement)) return;

  const page = document.querySelector("#share-page");
  const subject = document.querySelector("#share-subject");
  const next = document.querySelector("#share-next");
  const typeInput = form.elements.namedItem("type");
  const startTime = form.elements.namedItem("start_time");
  const items = form.elements.namedItem("items");
  const itemsLabel = items.closest("label");

  page.value = window.location.href;
  next.value = new URL("thanks.html", window.location.href).href;
  document.documentElement.classList.add("js");

  const syncTypeFields = () => {
    const rules = requirementsFor(typeInput.value);
    setRequired(startTime, rules.startTime);
    setRequired(items, rules.items);
    itemsLabel.classList.toggle("is-shown", rules.items);
  };

  typeInput.addEventListener("change", syncTypeFields);
  syncTypeFields();

  form.addEventListener("invalid", (event) => {
    showError(event.target);
    form.classList.add("show-invalid");
  }, true);

  form.addEventListener("input", (event) => {
    const field = event.target;
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) {
      if (field.validity.valid) clearError(field);
    }
  });

  form.addEventListener("submit", () => {
    const type = typeInput.value;
    const title = form.elements.namedItem("title").value.trim();
    subject.value = `What's On Toowoomba: ${type}: ${title}`.slice(0, 180);
    next.value = new URL("thanks.html", window.location.href).href;
    page.value = window.location.href;
  });
}

if (typeof document !== "undefined") initShareForm();
