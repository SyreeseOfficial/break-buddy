import { useEffect, useState } from "react";
import { PanelSection, PanelSectionRow, ToggleField, staticClasses } from "@decky/ui";
import { addEventListener, callable, definePlugin, removeEventListener, toaster } from "@decky/api";
import { FaRegBell } from "react-icons/fa";

const getEnabled = callable<[], boolean>("get_enabled");
const setEnabled = callable<[enabled: boolean], boolean>("set_enabled");

function Content() {
  const [enabled, setEnabledState] = useState(true);

  // useEffect with [] runs once when the panel opens (like onCreate); load current state from Python.
  useEffect(() => {
    getEnabled().then(setEnabledState);
  }, []);

  return (
    <PanelSection title="Break Buddy">
      <PanelSectionRow>
        <ToggleField
          label="Eye break (every 20 min)"
          checked={enabled}
          onChange={(v) => setEnabled(v).then(setEnabledState)}
        />
      </PanelSectionRow>
    </PanelSection>
  );
}

export default definePlugin(() => {
  // Registered here (not in Content) so toasts show even when the QAM is closed.
  const onFired = (_id: string, title: string) => {
    // body is required by ToastData; empty = title only (PRD 3.4)
    toaster.toast({ title, body: "", duration: 5000 });
  };
  addEventListener<[string, string]>("reminder_fired", onFired);

  return {
    name: "Break Buddy",
    titleView: <div className={staticClasses.Title}>Break Buddy</div>,
    content: <Content />,
    icon: <FaRegBell />,
    onDismount() {
      removeEventListener("reminder_fired", onFired);
    },
  };
});
