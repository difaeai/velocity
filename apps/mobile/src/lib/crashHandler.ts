/**
 * The part of crash reporting that decides when React Native's own handler
 * runs. Pure, so it can be tested; featureCheck supplies the report.
 */
export type GlobalHandler = (error: unknown, isFatal?: boolean) => void;

/**
 * Put `report` in front of the handler the app already has. A non-fatal error
 * is reported and handed on at once. A fatal one is held until the report is
 * saved and sent, or `holdMs` passes, whichever is first — then handed on
 * exactly once, because the handler it goes to closes the app.
 */
export function chainCrashHandler(
  previous: GlobalHandler,
  report: (error: unknown, isFatal: boolean) => Promise<unknown>,
  holdMs = 1500,
): GlobalHandler {
  return (error, isFatal) => {
    if (!isFatal) {
      void report(error, false).catch(() => {});
      previous(error, isFatal);
      return;
    }
    let handedOver = false;
    const handOver = () => {
      if (handedOver) return;
      handedOver = true;
      previous(error, isFatal);
    };
    setTimeout(handOver, holdMs);
    // A report that fails must still let the app close the way it would have.
    report(error, true).catch(() => {}).finally(handOver);
  };
}
