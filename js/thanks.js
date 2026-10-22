const params = new URLSearchParams(window.location.search);
if (params.get("reported") === "1") {
  const title = document.querySelector("h1");
  const lede = document.querySelector(".lede");
  if (title) title.textContent = "Thanks, the report is in";
  if (lede) {
    lede.textContent = "One report hides that community listing on the next automatic check. The admin inbox has the report.";
  }
}
