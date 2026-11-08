import { PanelSection, PanelSectionRow, staticClasses } from "@decky/ui";
import { definePlugin } from "@decky/api";
import { FaRegBell } from "react-icons/fa";

function Content() {
  return (
    <PanelSection title="Break Buddy">
      <PanelSectionRow>Hello from Break Buddy.</PanelSectionRow>
    </PanelSection>
  );
}

export default definePlugin(() => ({
  name: "Break Buddy",
  titleView: <div className={staticClasses.Title}>Break Buddy</div>,
  content: <Content />,
  icon: <FaRegBell />,
}));
