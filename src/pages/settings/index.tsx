import {
  Theme,
  AlwaysOnTopToggle,
  AppIconToggle,
  AutostartToggle,
} from "./components";
import { PageLayout } from "@/layouts";
import { getPlatform } from "@/lib";

const Settings = () => {
  return (
    <PageLayout title="Settings" description="Manage your settings">
      {/* Theme */}
      <Theme />

      {/* Autostart Toggle */}
      <AutostartToggle />

      {/* App Icon Toggle (macOS never shows a Dock icon) */}
      {getPlatform() !== "macos" && <AppIconToggle />}

      {/* Always On Top Toggle */}
      <AlwaysOnTopToggle />
    </PageLayout>
  );
};

export default Settings;
