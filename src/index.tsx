import { useEffect, useState } from "react";
import {
  ButtonItem,
  ConfirmModal,
  PanelSection,
  PanelSectionRow,
  SliderField,
  ToggleField,
  showModal,
  staticClasses,
} from "@decky/ui";
import { addEventListener, callable, definePlugin, removeEventListener } from "@decky/api";
import { FaRegBell } from "react-icons/fa";
import { enqueueToast } from "./toastQueue";
import { CustomForm } from "./components/CustomForm";

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
const updateReminder = callable<
  [id: string, patch: Partial<Pick<Reminder, "enabled" | "interval_seconds" | "label" | "message" | "mode" | "fire_at">>],
  State
>("update_reminder");
const addCustom = callable<[label: string, mode: "once" | "repeat", minutes: number], State>("add_custom");
const testToast = callable<[], void>("test_toast");
const resetDefaults = callable<[], State>("reset_defaults");
const deleteReminder = callable<[id: string], State>("delete_reminder");

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

  const builtins = state.reminders.filter((r) => r.type === "builtin");
  const customs = state.reminders.filter((r) => r.type === "custom");

  const openAdd = () =>
    showModal(
      <CustomForm
        title="Add reminder"
        initial={{ label: "", mode: "once", minutes: 15 }}
        onSave={(v) => addCustom(v.label, v.mode, v.minutes).then(setState)}
      />
    );

  const openEdit = (r: Reminder) =>
    showModal(
      <CustomForm
        title="Edit reminder"
        initial={{
          label: r.label,
          mode: r.mode,
          // one-shot: show minutes left (rounded to the slider's 5-min step); repeat: its interval
          minutes: Math.min(120, Math.max(5, Math.round(((r.mode === "once" && r.next_fire ? r.next_fire - Date.now() / 1000 : r.interval_seconds)) / 300) * 5)),
        }}
        onSave={(v) =>
          updateReminder(r.id, {
            label: v.label,
            message: v.label,
            mode: v.mode,
            ...(v.mode === "once" ? { fire_at: Date.now() / 1000 + v.minutes * 60 } : { interval_seconds: v.minutes * 60 }),
          }).then(setState)
        }
      />
    );

  const confirmReset = () =>
    showModal(
      <ConfirmModal
        strTitle="Reset to defaults?"
        strDescription="Restores the built-in reminders. Custom reminders are kept."
        strOKButtonText="Reset"
        bDestructiveWarning
        onOK={() => resetDefaults().then(setState)}
      />
    );

  const confirmDelete = (r: Reminder) =>
    showModal(
      <ConfirmModal
        strTitle="Delete reminder?"
        strDescription={r.label}
        strOKButtonText="Delete"
        bDestructiveWarning
        onOK={() => deleteReminder(r.id).then(setState)}
      />
    );

  return (
    <>
      <PanelSection title="Break Buddy">
        <PanelSectionRow>
          <ToggleField label="Reminders" checked={state.master_enabled} onChange={(v) => setMaster(v).then(setState)} />
        </PanelSectionRow>
      </PanelSection>
      <PanelSection title="Built-in reminders">
        {builtins.map((r) => (
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
      <PanelSection title="Custom reminders">
        {customs.map((r) => (
          <div key={r.id}>
            <PanelSectionRow>
              <ToggleField
                label={r.label}
                description={r.enabled && state.master_enabled && r.next_fire ? `Next in ${mmss(r.next_fire - now / 1000)}` : undefined}
                checked={r.enabled}
                disabled={!state.master_enabled}
                onChange={(v) => updateReminder(r.id, { enabled: v }).then(setState)}
              />
            </PanelSectionRow>
            <PanelSectionRow>
              <ButtonItem layout="below" onClick={() => openEdit(r)}>
                Edit
              </ButtonItem>
            </PanelSectionRow>
            <PanelSectionRow>
              <ButtonItem layout="below" onClick={() => confirmDelete(r)}>
                Delete
              </ButtonItem>
            </PanelSectionRow>
          </div>
        ))}
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={openAdd}>
            Add reminder
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>
      <PanelSection title="Utilities">
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={() => testToast()}>
            Send test toast
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={confirmReset}>
            Reset to defaults
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>
    </>
  );
}

export default definePlugin(() => {
  // Registered here (not in Content) so toasts show even when the QAM is closed.
  const show = enqueueToast;
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
