import { describe, it, expect } from "vitest";
import { resolveDeviceCapabilities } from "../../src/services/phoneAssistantPolicyService.js";

// The Samsung A07 reported every Android permission as off when it paired, then the user granted
// them. That stale report blocked caller briefs, so real calls showed no popup.
describe("reported Android permissions", () => {
  it("do not block caller briefs or push, even when the report says they are off", () => {
    const { effective, reasons } = resolveDeviceCapabilities({
      device: {
        status: "ACTIVE",
        capabilities: null,
        reported_state: {
          call_screening_role: false,
          overlay_permission: false,
          notifications_permission: false,
          battery_optimization_exempt: false,
        },
      },
      isAdmin: true,
      planHasPhoneAssistant: true,
    });
    expect(effective.caller_brief).toBe(true);
    expect(reasons.caller_brief).toBeNull();
    expect(effective.push).toBe(true);
  });
});
