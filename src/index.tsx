import { useEffect, useState } from "react";
import { PanelSection, PanelSectionRow, SliderField, ToggleField, staticClasses } from "@decky/ui";
import { addEventListener, callable, definePlugin, removeEventListener, toaster } from "@decky/api";
import { FaRegBell } from "react-icons/fa";

interface Reminder {
  id: string;
  label: string;
  message: string;
  type: "builtin" | "custom";
  mode: "repeat" | "once";
  interval_seconds: number;
  fire_at: number | null;
  enabled: boolean;
  next_fire: number | null; // epoch seconds, display only
}
interface State {
  master_enabled: boolean;
  reminders: Reminder[];
}

const getState = callable<[], State>("get_state");
const setMaster = callable<[enabled: boolean], State>("set_master");
const updateReminder = callable<[id: string, patch: Partial<Pick<Reminder, "enabled" | "interval_seconds">>], State>(
  "update_reminder"
);

const frontendReady = callable<[], { id: string; title: string }[]>("frontend_ready");
const frontendGone = callable<[], void>("frontend_gone");

function mmss(secs: number) {
  const s = Math.max(0, Math.floor(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function Content() {
  const [state, setState] = useState<State | null>(null);
  const [now, setNow] = useState(Date.now());

  // useEffect with [] runs once when the panel opens (like onCreate).
  useEffect(() => {
    getState().then(setState);
    // Tick once a second so "next in" re-renders; the cleanup stops it when the panel closes.
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Re-fetch when the backend says something changed (after a toast fires, deadlines move).
  useEffect(() => {
    const refresh = () => getState().then(setState);
    addEventListener("reminder_fired", refresh);
    addEventListener("state_changed", refresh); // e.g. after resume from suspend
    return () => {
      removeEventListener("reminder_fired", refresh);
      removeEventListener("state_changed", refresh);
    };
  }, []);

  if (!state) return null;

  return (
    <>
      <PanelSection title="Break Buddy">
        <PanelSectionRow>
          <ToggleField label="Reminders" checked={state.master_enabled} onChange={(v) => setMaster(v).then(setState)} />
        </PanelSectionRow>
      </PanelSection>
      <PanelSection title="Built-in reminders">
        {state.reminders.map((r) => (
          <div key={r.id}>
            <PanelSectionRow>
              <ToggleField
                label={r.label}
                checked={r.enabled}
                disabled={!state.master_enabled}
                onChange={(v) => updateReminder(r.id, { enabled: v }).then(setState)}
              />
            </PanelSectionRow>
            {/* @decky/ui has no collapsible component: show details only while enabled (plan decision 4) */}
            {r.enabled && state.master_enabled && (
              <>
                <PanelSectionRow>
                  <SliderField
                    label="Every (min)"
                    value={r.interval_seconds / 60}
                    min={5}
                    max={120}
                    step={5}
                    showValue
                    onChange={(m) => updateReminder(r.id, { interval_seconds: m * 60 }).then(setState)}
                  />
                </PanelSectionRow>
                <PanelSectionRow>
                  <div>{r.next_fire ? `Next in ${mmss(r.next_fire - now / 1000)}` : ""}</div>
                </PanelSectionRow>
              </>
            )}
          </div>
        ))}
      </PanelSection>
    </>
  );
}

export default definePlugin(() => {
  // Registered here (not in Content) so toasts show even when the QAM is closed.
  const show = (title: string) => {
    // body is required by ToastData; empty = title only (PRD 3.4)
    toaster.toast({ title, body: "", duration: 5000 });
  };
  const onFired = (_id: string, title: string) => show(title);
  addEventListener<[string, string]>("reminder_fired", onFired);
  // Tell backend we're listening; it returns anything that fired while the UI was gone.
  frontendReady().then((items) => items.forEach((i) => show(i.title)));

  return {
    name: "Break Buddy",
    titleView: <div className={staticClasses.Title}>Break Buddy</div>,
    content: <Content />,
    icon: <FaRegBell />,
    onDismount() {
      removeEventListener("reminder_fired", onFired);
      frontendGone();
    },
  };
});
