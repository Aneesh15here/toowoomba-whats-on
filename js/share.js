const form = document.querySelector("#share-form");
const page = document.querySelector("#share-page");
const subject = document.querySelector("#share-subject");
const next = document.querySelector("#share-next");

page.value = window.location.href;
next.value = new URL("thanks.html", window.location.href).href;

form.addEventListener("submit", () => {
  const type = form.elements.type.value;
  const title = form.elements.title.value.trim();
  subject.value = `What's On Toowoomba: ${type}: ${title}`.slice(0, 180);
  next.value = new URL("thanks.html", window.location.href).href;
  page.value = window.location.href;
});
