import { loadSettings, saveSettings, SettingsStore } from "./settings";
describe("nonsensitive preferences", () => {
  it("defaults to full blood and OS motion preference", () => expect(loadSettings()).toMatchObject({ blood: "full", haptics: true, reducedMotion: false }));
  it("migrates malformed values safely and clamps volume", () => { localStorage.setItem("hands.preferences.v1", JSON.stringify({ volume: 99, haptics: "yes", reducedMotion: true, blood: "unknown", token: "must-not-propagate" })); expect(loadSettings()).toEqual({ volume: 1, haptics: true, reducedMotion: true, blood: "full", camera: "broadcast" }); });
  it("persists only allowlisted preferences", () => { saveSettings({ volume: 0.4, haptics: false, reducedMotion: true, blood: "off", camera: "fighter" }); const raw = localStorage.getItem("hands.preferences.v1")!; expect(raw).toContain('"blood":"off"'); expect(raw).not.toMatch(/token|ticket|state/u); const store = new SettingsStore(); store.update({ blood: "reduced" }); expect(store.current.blood).toBe("reduced"); store.destroy(); });
  it("keeps a chosen camera and rejects unknown ones", () => {
    saveSettings({ volume: 0.5, haptics: true, reducedMotion: false, blood: "full", camera: "close" });
    expect(loadSettings().camera).toBe("close");
    localStorage.setItem("hands.preferences.v1", JSON.stringify({ camera: "drone" }));
    expect(loadSettings().camera).toBe("broadcast");
  });
  it("survives storage read and write failures", () => { const broken = { getItem: () => { throw new Error("read blocked"); }, setItem: () => { throw new Error("write blocked"); } } as unknown as Storage; expect(loadSettings(broken)).toMatchObject({ blood: "full" }); expect(() => saveSettings({ volume: 0.5, haptics: true, reducedMotion: false, blood: "off", camera: "broadcast" }, broken)).not.toThrow(); const store = new SettingsStore(broken); expect(() => store.update({ blood: "reduced" })).not.toThrow(); expect(store.current.blood).toBe("reduced"); });
});
