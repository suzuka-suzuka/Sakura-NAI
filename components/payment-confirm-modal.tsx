"use client";
import { useStore } from "@/lib/store";
import { translateUI, useLocale } from "@/lib/i18n";
import { Modal } from "./ui/modal";
import { Button } from "./ui/button";
import { imageToolOutputSize } from "@/lib/nai/image-tools";

export function PaymentConfirmModal() {
  useLocale();
  const pending = useStore(s => s.pendingPayment);
  const confirm = useStore(s => s.confirmPayment);
  const cancel = useStore(s => s.cancelPayment);
  const output = pending ? pending.settings.imageSource?.mode === "infill" && pending.settings.imageSource.focused ? pending.settings : imageToolOutputSize(pending.settings) : null;
  return <Modal open={!!pending} onClose={cancel} title={translateUI("This generation costs Anlas")} className="max-w-md">
    {pending && output && <p className="mb-3 font-mono text-xs text-muted">{output.width}×{output.height} · {translateUI("{0} steps · {1} image(s)", pending.settings.steps, pending.settings.nSamples)}</p>}
    <p className="text-sm leading-relaxed text-fg-2">{translateUI("The current batch is estimated to cost {0} points. Continue?", pending?.cost ?? 0)}</p>
    <div className="mt-5 flex justify-end gap-2">
      <Button variant="ghost" onClick={cancel}>{translateUI("Cancel")}</Button>
      <Button onClick={() => void confirm()}>{translateUI("Confirm and generate")}</Button>
    </div>
  </Modal>;
}
