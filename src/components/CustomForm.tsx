import { useState } from "react";
import { ConfirmModal, DropdownItem, SliderField, TextField } from "@decky/ui";

export interface CustomValues {
  label: string;
  mode: "once" | "repeat";
  minutes: number;
}

// Modal form for add and edit. Shown via showModal(), which injects closeModal.
export function CustomForm(props: {
  initial: CustomValues;
  title: string;
  onSave: (v: CustomValues) => void;
  closeModal?: () => void;
}) {
  // useState = a field that re-renders the form when set.
  const [v, setV] = useState(props.initial);
  return (
    <ConfirmModal
      strTitle={props.title}
      strOKButtonText="Save"
      bOKDisabled={!v.label.trim()}
      onOK={() => props.onSave({ ...v, label: v.label.trim() })}
      closeModal={props.closeModal}
    >
      <TextField label="Label" value={v.label} focusOnMount onChange={(e) => setV({ ...v, label: e.target.value })} />
      <DropdownItem
        label="Type"
        rgOptions={[
          { data: "once", label: "One-shot (in N minutes)" },
          { data: "repeat", label: "Repeating (every N minutes)" },
        ]}
        selectedOption={v.mode}
        onChange={(o) => setV({ ...v, mode: o.data })}
      />
      <SliderField
        label={v.mode === "once" ? "In (min)" : "Every (min)"}
        value={v.minutes}
        min={5}
        max={120}
        step={5}
        showValue
        onChange={(minutes) => setV({ ...v, minutes })}
      />
    </ConfirmModal>
  );
}
