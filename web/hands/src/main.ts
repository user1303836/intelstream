import "./style.css";
import { HandsApp } from "./app";
import { runDevelopmentFixture } from "./dev-fixtures";
import { runLab } from "./lab/lab";
import { runModelLab } from "./lab/model-lab";

const root = document.querySelector<HTMLElement>("#app");
if (root === null) throw new Error("app_root_missing");
let teardown: () => void;
const params = new URLSearchParams(window.location.search);
const labMode = window.location.pathname.endsWith("/hands/lab") || params.get("lab") === "1";
const modelLabMode = window.location.pathname.endsWith("/hands/model-lab") || params.get("model-lab") === "1";
if (modelLabMode) teardown = runModelLab(root);
else if (labMode) teardown = runLab(root);
else if (import.meta.env.DEV && params.get("fixture") === "1") teardown = runDevelopmentFixture(root);
else {
  const app = new HandsApp(root);
  app.start();
  teardown = () => app.destroy();
}
window.addEventListener("pagehide", teardown, { once: true });
