"use client";
import { useStore } from "@/lib/store";
import { translateUI, useLocale } from "@/lib/i18n";
import { Modal } from "./ui/modal";
import { Button } from "./ui/button";

export function PaymentConfirmModal() {
  useLocale();
  const pending = useStore(s => s.pendingPayment);
  const confirm = useStore(s => s.confirmPayment);
  const cancel = useStore(s => s.cancelPayment);
  return <Modal open={!!pending} onClose={cancel} title={translateUI("This generation costs Anlas")} className="max-w-md">
    {pending && <p className="mb-3 font-mono text-xs text-muted">{pending.settings.width}×{pending.settings.height} · {translateUI("{0} steps · {1} image(s)", pending.settings.steps, pending.settings.nSamples)}</p>}
    <p className="text-sm leading-relaxed text-fg-2">{translateUI("The current batch is estimated to cost {0} points. Continue?", pending?.cost ?? 0)}</p>
    <p className="mt-2 text-xs leading-relaxed text-muted">{translateUI("We remind you once when entering paid generation. Returning to 0 points re-enables the reminder. You can disable it in Advanced settings.")}</p>
    <div className="mt-5 flex justify-end gap-2">
      <Button variant="ghost" onClick={cancel}>{translateUI("Cancel")}</Button>
      <Button onClick={() => void confirm()}>{translateUI("Confirm and generate")}</Button>
    </div>
  </Modal>;
}
