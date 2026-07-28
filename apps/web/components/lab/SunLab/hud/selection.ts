import type { GroupId } from "../sunLabModel";

/** What the HUD currently has selected. Drives which panel the right column shows. */
export type Selection =
  | { kind: "global" }
  | { kind: "group"; groupId: GroupId }
  | { kind: "object"; id: string }
  | { kind: "material"; name: string };
