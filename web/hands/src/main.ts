import "./style.css";
import { HandsApp } from "./app";
import { runDevelopmentFixture } from "./dev-fixtures";

const root = document.querySelector<HTMLElement>("#app");
if (root === null) throw new Error("app_root_missing");
let teardown: () => void;
if (import.meta.env.DEV && new URLSearchParams(window.location.search).get("fixture") === "1") teardown = runDevelopmentFixture(root);
else { const app = new HandsApp(root); app.start(); teardown = () => app.destroy(); }
window.addEventListener("pagehide", teardown, { once: true });
