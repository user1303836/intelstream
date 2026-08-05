import "./style.css";
import { HandsApp } from "./app";
import { runDevelopmentFixture } from "./dev-fixtures";
import { runLab } from "./lab/lab";

const root = document.querySelector<HTMLElement>("#app");
if (root === null) throw new Error("app_root_missing");
let teardown: () => void;
const params = new URLSearchParams(window.location.search);
const labMode = window.location.pathname.endsWith("/hands/lab") || (import.meta.env.DEV && params.get("lab") === "1");
if (labMode) teardown = runLab(root);
else if (import.meta.env.DEV && params.get("fixture") === "1") teardown = runDevelopmentFixture(root);
else {
  const app = new HandsApp(root);
  app.start();
  teardown = () => app.destroy();
}
window.addEventListener("pagehide", teardown, { once: true });
