// Fake "gpui-base" module for tests.
import { element } from "../element.js";

export const v_flex = (...a) => element("v_flex", a);
export const h_flex = (...a) => element("h_flex", a);

/**
 * A text field's state. Test helpers: type(text, cx) sets the value and fires "change";
 * emit(event, cx) fires "submit", "focus", "blur"... like the user would.
 */
export const InputState = {
  new(opts = {}) {
    const handlers = {};
    const state = {
      placeholder: opts.placeholder ?? "",
      _value: opts.value ?? "",
      value: () => state._value,
      set_value(v) {
        state._value = v;
      },
      on(ev, h) {
        (handlers[ev] ??= []).push(h);
        return true;
      },
      focus() {},
      type(text, cx) {
        state._value = text;
        state.emit("change", cx);
      },
      emit(ev, cx, payload = {}) {
        for (const h of handlers[ev] ?? []) h(payload, cx);
      },
    };
    return state;
  },
};

export const Input = { new: (state) => element("Input", [state]) };
